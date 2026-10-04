#!/usr/bin/env node
// Pinned, isolated Neon development branch only. Never load .env files or infer a database.
// Every synthetic fixture and every financial operation is enclosed in one ROLLBACK transaction.
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'

const allowedHost = 'ep-broad-tooth-az9zz1z8.c-3.ap-southeast-1.aws.neon.tech'
const expected = process.env.EXPECTED_NEON_BRANCH_HOST
const rawUrl = process.env.DATABASE_URL_UNPOOLED
if (!expected || expected !== allowedHost || !rawUrl) throw new Error('Explicit test-branch host and direct database URL are required; no defaults are permitted')
const parsed = new URL(rawUrl)
if (parsed.hostname !== expected || parsed.hostname.includes('-pooler') || parsed.protocol !== 'postgresql:') {
  throw new Error('Database target is not the pinned isolated Neon test branch')
}
const db = new pg.Client({ connectionString: rawUrl, connectionTimeoutMillis: 15000, statement_timeout: 30000 })
const fixtureSuffix = randomUUID().replaceAll('-', '').slice(0, 12)
const employeeCode = `QA_${fixtureSuffix}`
const studentCode = `QA_STUDENT_${fixtureSuffix}`
const sku = `QA_TENDER_${fixtureSuffix}`
const proof = () => randomBytes(32).toString('hex')
const staffProof = proof(), studentProof = proof(), cardFingerprint = proof()
let stage = 'connect', inTransaction = false
const checks = []
const record = name => checks.push(name)
const one = async (sql, params = []) => (await db.query(sql, params)).rows[0]
const runtime = () => db.query('set local role campuspay_runtime')
const owner = () => db.query('reset role')
async function expectRejection(sql, params, pattern) {
  await db.query('savepoint expected_failure')
  let rejected = false
  try { await db.query(sql, params) }
  catch (error) { assert.match(error.message, pattern); rejected = true }
  finally { await db.query('rollback to savepoint expected_failure'); await db.query('release savepoint expected_failure') }
  assert.equal(rejected, true, 'Expected authoritative rejection')
}
let studentId, productId, intentId, completedSaleId
try {
  await db.connect()
  stage = 'begin isolated fixture transaction'
  await db.query('begin'); inTransaction = true
  await db.query("set local lock_timeout='10s'")
  const grants = await one(`select
    has_schema_privilege('campuspay_runtime','private','USAGE') as private_usage,
    has_table_privilege('campuspay_runtime','private.wallets','SELECT') as wallet_read,
    has_table_privilege('campuspay_runtime','private.sale_tenders','INSERT') as tender_write,
    has_function_privilege('campuspay_runtime','api.enroll_student(uuid,text,text,text,text,uuid)','EXECUTE') as enroll,
    has_function_privilege('campuspay_runtime','api.confirm_payment(uuid,uuid,text,bigint)','EXECUTE') as settle`)
  assert.equal(grants.private_usage, false); assert.equal(grants.wallet_read, false); assert.equal(grants.tender_write, false)
  assert.equal(grants.enroll, true); assert.equal(grants.settle, true); record('runtime API grants and private-table isolation')

  stage = 'create fresh synthetic staff fixture'
  const staff = await one("insert into public.staff_profiles(employee_code,display_name,role) values($1,'Isolated branch QA staff','super_admin') returning auth_user_id", [employeeCode])
  await db.query("insert into private.staff_credentials(staff_user_id,pin_hash) values($1,extensions.crypt($2,extensions.gen_salt('bf',12)))", [staff.auth_user_id, staffProof])
  await runtime()
  await expectRejection('select * from private.wallets limit 1', [], /permission denied/)
  const session = await one('select * from api.create_staff_session($1,$2,$3,$4)', [employeeCode, staffProof, proof(), proof()])
  assert.equal(session.role, 'super_admin')

  stage = 'atomic E202 enrollment through runtime API'
  const enrollmentKey = randomUUID()
  const enrolled = await one('select * from api.enroll_student($1,$2,$3,$4,$5,$6)', [session.session_id, studentCode, 'Isolated branch QA student', cardFingerprint, studentProof, enrollmentKey])
  assert.equal(enrolled.outcome, 'ENROLLED'); assert.equal(Number(enrolled.balance_won), 0); assert.equal(enrolled.card_active, true)
  studentId = enrolled.student_id
  const replay = await one('select * from api.enroll_student($1,$2,$3,$4,$5,$6)', [session.session_id, studentCode, 'Isolated branch QA student', cardFingerprint, studentProof, enrollmentKey])
  assert.equal(replay.student_id, studentId)
  const duplicate = await one('select * from api.enroll_student($1,$2,$3,$4,$5,$6)', [session.session_id, studentCode, 'Duplicate must fail', proof(), studentProof, randomUUID()])
  assert.equal(duplicate.outcome, 'STUDENT_EXISTS')
  const duplicateCardCode = `${studentCode}_2`
  const duplicateCard = await one('select * from api.enroll_student($1,$2,$3,$4,$5,$6)', [session.session_id, duplicateCardCode, 'Duplicate card must fail', cardFingerprint, studentProof, randomUUID()])
  assert.equal(duplicateCard.outcome, 'CARD_ASSIGNED')
  const customer = await one('select * from api.create_customer_session($1,$2,$3,$4)', [cardFingerprint, studentProof, proof(), proof()])
  assert.equal(customer.student_id, studentId)
  await owner()
  const artifacts = await one(`select
    (select count(*) from private.students where id=$1) as students,
    (select count(*) from private.wallets where student_id=$1 and balance_won=0) as wallets,
    (select count(*) from private.student_credentials where student_id=$1) as credentials,
    (select count(*) from private.student_cards where student_id=$1 and active) as cards,
    (select count(*) from private.audit_events where subject_id=$1 and event_type='STUDENT_ENROLLED') as audits,
    (select count(*) from private.students where student_code=$2) as failed_duplicate`, [studentId, duplicateCardCode])
  for (const key of ['students', 'wallets', 'credentials', 'cards', 'audits']) assert.equal(Number(artifacts[key]), 1)
  assert.equal(Number(artifacts.failed_duplicate), 0)
  record('atomic zero-balance enrollment, idempotency, duplicate student/card rejection, customer authentication')

  stage = 'create and receive independent product stock through runtime API'
  await runtime()
  const productKey = randomUUID()
  const product = await one(`select (result->>'target_id')::uuid as reference_id
    from api.change_record($1,$2,'PRODUCT','CREATE_PRODUCT',null,$3::jsonb,null,$4)`,
    [session.session_id, productKey, JSON.stringify({ sku, name: 'Isolated branch split-tender item', category: 'QA fixture', selling_price_won: 12000, reorder_level: 0 }), 'Synthetic branch product fixture'])
  productId = product.reference_id
  const stockKey = randomUUID()
  const stockArgs = [session.session_id, 'Isolated branch QA', `QA-${fixtureSuffix}`, '2026-09-07', 0, 0, 0, 'Synthetic stock; transaction will roll back', JSON.stringify([{ productId, quantity: 5, purchaseUnitCostWon: 1000 }]), stockKey]
  const stockSql = 'select * from api.receive_stock($1,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10)'
  const stock = await one(stockSql, stockArgs)
  assert.equal(Number(stock.total_quantity), 5)
  stage = 'stock receipt replay/recovery'
  const stockSnapshot = async () => {
    await owner()
    return one(`select
      (select count(*) from private.stock_receipts where idempotency_key=$1) as receipts,
      (select count(*) from private.stock_receipt_lines where receipt_id=$2) as lines,
      (select sum(quantity) from private.stock_receipt_lines where receipt_id=$2) as received_quantity,
      (select count(*) from private.inventory_lots l join private.stock_receipt_lines sl on sl.id=l.receipt_line_id where sl.receipt_id=$2) as lots,
      (select sum(l.quantity_remaining) from private.inventory_lots l join private.stock_receipt_lines sl on sl.id=l.receipt_line_id where sl.receipt_id=$2) as remaining_quantity,
      (select count(*) from private.inventory_movements where source_type='STOCK_RECEIPT' and source_id=$2) as movements`, [stockKey, stock.receipt_id])
  }
  const stockBefore = await stockSnapshot()
  await runtime()
  const stockReplay = await one(stockSql, stockArgs)
  assert.equal(stockReplay.receipt_id, stock.receipt_id); assert.equal(Number(stockReplay.total_quantity), 5)
  const stockRecovery = await one('select * from api.recover_stock_receipt($1,$2)', [session.session_id, stockKey])
  assert.equal(stockRecovery.receipt_id, stock.receipt_id); assert.equal(Number(stockRecovery.total_quantity), 5)
  assert.deepEqual(await stockSnapshot(), stockBefore)
  assert.equal(Number(stockBefore.receipts), 1); assert.equal(Number(stockBefore.lines), 1)
  assert.equal(Number(stockBefore.lots), 1); assert.equal(Number(stockBefore.movements), 1)
  assert.equal(Number(stockBefore.received_quantity), 5); assert.equal(Number(stockBefore.remaining_quantity), 5)
  record('stock receipt replay/recovery')
  await runtime()
  const cart = JSON.stringify([{ productId, quantity: 1 }])
  await expectRejection('select * from api.create_payment_intent($1,$2::jsonb,$3,null,$4,$5)', [session.session_id, cart, randomUUID(), 'SPLIT', 7000], /CASH_DISABLED/)
  await one("select * from api.set_terminal_payment_policy($1,true,$2,now()+interval '1 hour')", [session.session_id, 'Isolated branch QA event'])
  const intent = await one('select * from api.create_payment_intent($1,$2::jsonb,$3,null,$4,$5)', [session.session_id, cart, randomUUID(), 'SPLIT', 7000])
  intentId = intent.intent_id
  await one('select * from api.scan_payment_card($1,$2,$3)', [session.session_id, intentId, cardFingerprint])

  const financialSnapshot = async () => {
    await owner()
    return one(`select jsonb_build_object(
      'wallet',(select balance_won from private.wallets where student_id=$1),
      'ledger',(select count(*) from private.wallet_ledger where student_id=$1),
      'sales',(select count(*) from private.sales where payment_intent_id=$2),
      'tenders',(select count(*) from private.sale_tenders st join private.sales s on s.id=st.sale_id where s.payment_intent_id=$2),
      'stock',(select sum(quantity_remaining) from private.inventory_lots where product_id=$3),
      'movements',(select count(*) from private.inventory_movements where product_id=$3),
      'costs',(select count(*) from private.sale_cost_allocations a join private.sale_items i on i.id=a.sale_item_id where i.product_id=$3)) as state`, [studentId, intentId, productId])
  }
  stage = 'underpayment creates no financial or inventory mutation'
  const before = await financialSnapshot()
  await runtime()
  await expectRejection('select * from api.confirm_payment($1,$2,$3,$4)', [session.session_id, intentId, studentProof, 4000], /CASH_UNDERPAYMENT/)
  assert.deepEqual(await financialSnapshot(), before)
  record('₩4,000 cash underpayment leaves wallet, sale, tenders, inventory and COGS unchanged')

  stage = 'exact atomic split and deferred reconciliation'
  await runtime()
  const receipt = await one('select * from api.confirm_payment($1,$2,$3,$4)', [session.session_id, intentId, studentProof, 10000])
  assert.equal(receipt.approved, true); completedSaleId = receipt.sale_id
  assert.equal(Number(receipt.total_won), 12000); assert.equal(Number(receipt.wallet_tender_won), 7000)
  assert.equal(Number(receipt.cash_tender_won), 5000); assert.equal(Number(receipt.cash_received_won), 10000)
  assert.equal(Number(receipt.change_given_won), 5000); assert.equal(Number(receipt.cogs_won), 1000)
  assert.equal(Number(receipt.balance_after_won), -7000)
  const repeated = await one('select * from api.confirm_payment($1,$2,$3,$4)', [session.session_id, intentId, studentProof, 10000])
  assert.equal(repeated.sale_id, completedSaleId)
  await owner()
  // Force every deferred journal invariant now, even though fixture data will never commit.
  await db.query('set constraints all immediate')
  const settlement = await one(`select s.channel,s.total_won,s.cost_of_goods_sold_won,
    (select count(*) from private.sale_items where sale_id=s.id) as items,
    (select sum(settled_amount_won) from private.sale_tenders where sale_id=s.id) as tender_sum,
    (select count(*) from private.sale_tenders where sale_id=s.id) as tender_count,
    (select amount_won from private.wallet_ledger where id=s.wallet_ledger_id) as wallet_debit,
    (select sum(quantity_remaining) from private.inventory_lots where product_id=$2) as remaining,
    (select count(*) from private.sale_cost_allocations a join private.sale_items i on i.id=a.sale_item_id where i.sale_id=s.id) as costs
    from private.sales s where s.id=$1`, [completedSaleId, productId])
  assert.equal(settlement.channel, 'POS'); assert.equal(Number(settlement.total_won), 12000)
  assert.equal(Number(settlement.tender_sum), 12000); assert.equal(Number(settlement.tender_count), 2)
  assert.equal(Number(settlement.wallet_debit), -7000); assert.equal(Number(settlement.remaining), 4)
  assert.equal(Number(settlement.cost_of_goods_sold_won), 1000); assert.equal(Number(settlement.items), 1); assert.equal(Number(settlement.costs), 1)
  record('₩12,000 sale / ₩7,000 wallet / ₩5,000 cash / ₩10,000 received / ₩5,000 change; exact inventory and COGS; replay idempotency; deferred constraints')

  stage = 'rollback all synthetic records'
  await db.query('rollback'); inTransaction = false
  const remaining = await one(`select
    (select count(*) from public.staff_profiles where employee_code=$1) as staff,
    (select count(*) from private.students where student_code=$2) as student,
    (select count(*) from public.products where sku=$3) as products,
    (select count(*) from private.sales where id=$4) as sales`, [employeeCode, studentCode, sku, completedSaleId])
  for (const count of Object.values(remaining)) assert.equal(Number(count), 0)
  record('ROLLBACK verified: no synthetic staff, student, product or sale remains')
  fs.mkdirSync('.validation', { recursive: true })
  fs.writeFileSync('.validation/neon-branch-results.json', JSON.stringify({ passed: true, branch: 'br-late-bread-azrpu2xh', host: expected, fixtureDataRolledBack: true, checks }, null, 2))
  console.log(`PASS: ${checks.length} isolated Neon checks; all fixture records rolled back`)
} catch (error) {
  console.error(`FAIL at ${stage}: ${error.code ?? 'ASSERTION'} ${error.message}`)
  process.exitCode = 1
} finally {
  if (inTransaction) await db.query('rollback').catch(() => {})
  await db.end()
}

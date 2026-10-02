import test from 'node:test'
import assert from 'node:assert/strict'
import { savedReceiptReference, confirmedStockReceipt, receiptRecoveryIssue, persistReceipt, forgetConfirmedReceipt, receiptStorageKey } from '../src/features/inventory/receipt-recovery.ts'
import { eventPaymentIssue } from '../src/features/pos/payment-policy-validation.ts'
const id = '10000000-0000-4000-8000-000000000001', other = '10000000-0000-4000-8000-000000000002'
const receipt = { receipt_id: id, receipt_number: 'RCV-SYNTHETIC', total_quantity: 10, purchase_subtotal_won: 5000, total_landed_cost_won: 5000, created_at: '2026-10-02T05:55:00Z' }
const now = Date.parse('2026-10-02T00:00:00Z')
test('a valid reference is recoverable even when the saved form is invalid', () => assert.equal(savedReceiptReference({ idempotencyKey: id, lines: 'bad' }), id))
for (const value of [null, [], {}, 'id', { idempotencyKey: 'bad' }]) test(`invalid saved reference: ${JSON.stringify(value)}`, () => assert.equal(savedReceiptReference(value), null))
test('complete confirmation accepted', () => assert.equal(confirmedStockReceipt(receipt), true))
for (const value of [null, {}, { receipt_number: 'RCV-PARTIAL' }, { ...receipt, receipt_id: 'bad' }, { ...receipt, created_at: 'bad' }, { ...receipt, total_quantity: 0 }, { ...receipt, total_landed_cost_won: -1 }, { ...receipt, total_quantity: Number.MAX_SAFE_INTEGER + 1 }]) test(`incomplete confirmation rejected: ${JSON.stringify(value)}`, () => assert.equal(confirmedStockReceipt(value), false))
for (const code of ['UNAUTHENTICATED', 'SESSION_EXPIRED']) test(`${code} requires original staff sign-in`, () => assert.equal(receiptRecoveryIssue({ code, status: 401, message: 'do not echo raw data' }).needsSignIn, true))
test('forbidden does not hide the operator/register restriction', () => assert.match(receiptRecoveryIssue({ code: 'FORBIDDEN', status: 403, message: 'x' }).message, /original browser\/register/))
test('invoice conflict never recommends changing invoice to bypass duplicate protection', () => assert.match(receiptRecoveryIssue({ code: 'RECEIPT_INVOICE_EXISTS', status: 409, message: 'x' }).message, /Do not rename/))
for (const error of [null, { code: 'INTERNAL_ERROR', status: 500, message: 'secret' }, { code: 'NOT_FOUND', status: 404, message: 'secret' }]) test(`unknown result preserves recovery: ${error?.status ?? 'network'}`, () => {
  assert.match(receiptRecoveryIssue(error).message, /same saved reference/)
  assert.equal(receiptRecoveryIssue(error).message.includes('secret'), false)
})
function storage() { const rows = new Map(); return { getItem: k => rows.get(k) ?? null, setItem: (k,v) => rows.set(k,v), removeItem: k => rows.delete(k) } }
test('reference persistence is scoped, verified, and never overwrites another pending request', () => {
  const s=storage(), raw=JSON.stringify({ idempotencyKey:id }); persistReceipt(s,'staff-a',raw)
  assert.equal(s.getItem(receiptStorageKey('staff-b')),null)
  assert.throws(() => persistReceipt(s,'staff-a','new'))
  assert.throws(() => forgetConfirmedReceipt(s,'staff-a',other))
  assert.equal(s.getItem(receiptStorageKey('staff-a')),raw)
  forgetConfirmedReceipt(s,'staff-a',id); assert.equal(s.getItem(receiptStorageKey('staff-a')),null)
})
test('silent storage failure blocks submission', () => assert.throws(() => persistReceipt({ getItem:()=>null, setItem:()=>{}, removeItem:()=>{} },'staff-a','request')))
test('silent reference deletion failure blocks clearing', () => assert.throws(() => forgetConfirmedReceipt({ getItem:()=>JSON.stringify({ idempotencyKey:id }), setItem:()=>{}, removeItem:()=>{} },'staff-a',id)))
for (const name of [null,'',' ', 'a', 'x'.repeat(81)]) test(`invalid event name: ${name?.length ?? 'null'}`, () => assert.equal(eventPaymentIssue(name,'2026-10-02T01:00:00Z',now)?.field,'eventName'))
for (const end of [null,undefined,'invalid']) test(`invalid event expiry: ${end}`, () => assert.equal(eventPaymentIssue('Event',end,now)?.field,'endsAt'))
for (const offset of [-1,0]) test(`past event expiry: ${offset}`, () => assert.match(eventPaymentIssue('Event',new Date(now+offset).toISOString(),now).message,/already passed/))
test('over-24-hour event expiry rejected', () => assert.match(eventPaymentIssue('Event',new Date(now+86400001).toISOString(),now).message,/at most 24 hours/))
for (const offset of [60000,3600000,86400000]) test(`valid event window: ${offset}`, () => assert.equal(eventPaymentIssue(' Event ',new Date(now+offset).toISOString(),now),null))

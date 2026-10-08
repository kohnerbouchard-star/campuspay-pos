#!/usr/bin/env node
import assert from 'node:assert/strict'
import { randomBytes, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import pg from 'pg'
import { refundTestContext } from './refund-test-context.mjs'
import { share, verifyPreviewMath } from './refund-preview-math.mjs'
import { runRefundPreviewBrowser } from './refund-preview-browser.mjs'

let ctx, phase = 'setup'; const checks = []
try {
  ctx = await refundTestContext(); const { owner, request, login, pin } = ctx
  const mathCases = await verifyPreviewMath(owner); checks.push(`${mathCases} exact SQL slices match independent BigInt arithmetic, including maximum bigint and telescoping partitions`)
  await ctx.start(false)
  let admin = await login(); const cashier = await login('1001'), accountant = await login('3001'), inventory = await login('2001')
  const products = await request(admin,'/api/pos/catalog'), water = products.find(p=>p.sku==='WATER-001'), cookie = products.find(p=>p.sku==='COOKIE-001')
  const card = 'PREVIEW'+randomBytes(12).toString('hex')
  await request(admin,'/api/students',{studentCode:'PREVIEW-'+randomUUID().slice(0,8),displayName:'Synthetic calculator customer',cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
  const customer = new Map(); await request(customer,'/api/store/login',{cardNumber:card,pin})
  const preview = (who, input, expected=200) => request(who,'/api/refunds/preview',input,expected)
  const selection = detail => ({saleId:detail.sale_id,items:detail.items.map(i=>({sale_item_id:i.sale_item_id,restock_quantity:i.quantity,write_off_quantity:0}))})
  const financialTables = ['students','student_cards','student_credentials','wallets','wallet_ledger','sales','sale_items','sale_cost_allocations','sale_tenders','sale_refunds','refund_tenders','refund_allocations','refund_request_closures','cash_refund_payouts','inventory_lots','inventory_movements','coupons','coupon_redemptions','online_orders','online_order_status_events','cash_shifts','cash_shift_events','cash_shift_closes','audit_events']
  const financialState = async () => JSON.stringify((await owner.query(financialTables.map(t => `select '${t}' relation,md5(coalesce(jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text)::text,'')) digest from private.${t} t`).join(' union all '))).rows)
  async function sale(mode='WALLET',items=[{productId:water.id,quantity:3},{productId:cookie.id,quantity:1}],couponCode) {
    if(mode!=='WALLET')await request(admin,'/api/pos/payment-policy',{cashEnabled:true,eventName:'Synthetic preview QA',endsAt:new Date(Date.now()+3600000).toISOString()})
    const intent=await request(admin,'/api/pos/intents',{items,tenderMode:mode,couponCode,idempotencyKey:randomUUID()},201)
    if(mode!=='CASH')await request(admin,`/api/pos/intents/${intent.intent_id}/card`,{cardRead:card})
    if(mode==='SPLIT')await request(admin,`/api/pos/intents/${intent.intent_id}/tender`,{walletAmountWon:501})
    const receipt=await request(admin,`/api/pos/intents/${intent.intent_id}/confirm`,{...(mode!=='CASH'?{pin}:{}),...(mode!=='WALLET'?{cashReceivedWon:10000}:{})})
    return request(admin,`/api/refunds/sale?reference=${receipt.sale_id}`)
  }
  const first=await sale(), input=selection(first)
  phase='gates';let before=await financialState()
  await preview(admin,input,409)
  await ctx.start(false,{partialPreview:true});admin=await login('9001',admin)
  assert.equal((await preview(admin,input)).outcome,'DISABLED')
  await owner.query('update private.system_settings set partial_refund_preview_enabled=true where singleton')
  for(const who of [new Map(),customer,cashier,inventory])await preview(who,input,who===cashier||who===inventory?403:401)
  assert.equal((await preview(accountant,input)).outcome,'PREVIEW')
  await request(admin,'/api/refunds/preview',input,403,'https://wrong-origin.example')
  for(const change of [{items:[]},{items:[input.items[0],input.items[0]]},{items:[{...input.items[0],restock_quantity:-1}]},{amountWon:1},{items:[{...input.items[0],write_off_quantity:0.5}]}])await preview(admin,{...input,...change},400)
  const tooMany={saleId:first.sale_id,items:[{...input.items[0],restock_quantity:999}]}
  assert.equal((await preview(admin,tooMany)).outcome,'INVALID_SELECTION')
  assert.equal((await preview(admin,{...input,items:[{...input.items[0],sale_item_id:randomUUID()}]})).outcome,'INVALID_SELECTION')
  assert.equal((await preview(admin,{...input,saleId:randomUUID()})).outcome,'NOT_FOUND')
  assert.equal(await financialState(),before)
  checks.push('dual default-off gates; accountant/admin read; anonymous/student/cashier/inventory/origin/input denials; no financial or roster writes')
  const withoutTime = result => {const {calculated_at,...rest}=result;assert.ok(calculated_at);return rest}
  async function assertQuote(detail, requested) {
    const q=await preview(admin,requested);assert.equal(q.outcome,'PREVIEW');assert.equal(q.preview_only,true);assert.equal(q.posting_available,false)
    const source=(await owner.query('select * from private.sales where id=$1',[detail.sale_id])).rows[0]
    const lines=(await owner.query('select * from private.sale_items where sale_id=$1 order by id',[detail.sale_id])).rows
    let prefix=0n,total=0n,cost=0n
    for(const line of lines){
      const net=BigInt(source.subtotal_won)===0n?0n:share(source.total_won,source.subtotal_won,prefix,line.line_total_won);prefix+=BigInt(line.line_total_won)
      const selected=requested.items.find(i=>i.sale_item_id===line.id);if(!selected)continue
      const actual=q.items.find(i=>i.sale_item_id===line.id),amount=share(net,line.quantity,0,selected.restock_quantity+selected.write_off_quantity)
      assert.equal(actual.original_line_net_won,Number(net));assert.equal(actual.refund_won,Number(amount));total+=amount
      const allocations=(await owner.query('select * from private.sale_cost_allocations where sale_item_id=$1 order by created_at,id',[line.id])).rows
      let r=selected.restock_quantity,w=selected.write_off_quantity
      for(const a of allocations){const nr=Math.min(r,a.quantity),nw=Math.min(w,a.quantity-nr);if(nr+nw===0)continue
        const seen=actual.allocations.find(v=>v.original_allocation_id===a.id)
        const rc=share(a.total_cost_won,a.quantity,0,nr),wc=share(a.total_cost_won,a.quantity,nr,nw)
        assert.equal(seen.restocked_cost_won,Number(rc));assert.equal(seen.write_off_cost_won,Number(wc));assert.equal(seen.inventory_lot_id,a.inventory_lot_id)
        cost+=rc+wc;r-=nr;w-=nw
      }
      assert.equal(r+w,0)
    }
    assert.equal(q.refund_won,Number(total));assert.equal(q.cogs_reversed_won,Number(cost))
    const wallet=BigInt(detail.total_won)===0n?0n:share(detail.wallet_tender_won,detail.total_won,0,total)
    assert.equal(q.wallet_credit_won,Number(wallet));assert.equal(q.cash_due_won,Number(total-wallet));return q
  }
  phase='original-allocation'
  await request(admin,'/api/coupons',{name:'One won original discount',code:'PREVIEWONE',discountType:'FIXED',fixedAmountWon:1,percentageBps:null,minimumSubtotalWon:0,maxDiscountWon:null,totalRedemptionLimit:null,perStudentLimit:null,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:null,idempotencyKey:randomUUID()},201)
  let browserSale
  for(const mode of ['WALLET','CASH','SPLIT']){
    const detail=mode==='WALLET'?first:await sale(mode,undefined,'PREVIEWONE')
    before=await financialState()
    if(detail.sale_id!==first.sale_id)assert.equal((await preview(admin,{saleId:first.sale_id,items:selection(detail).items})).outcome,'INVALID_SELECTION')
    const all=await assertQuote(detail,selection(detail));assert.equal(all.refund_won,detail.total_won);assert.equal(all.cogs_reversed_won,detail.cogs_won)
    assert.equal(all.wallet_credit_won,detail.wallet_tender_won);assert.equal(all.cash_due_won,detail.cash_tender_won)
    const item=detail.items.find(i=>i.quantity===3),partial={saleId:detail.sale_id,items:[{sale_item_id:item.sale_item_id,restock_quantity:1,write_off_quantity:1}]}
    const q=await assertQuote(detail,partial)
    assert.deepEqual(withoutTime(await preview(admin,partial)),withoutTime(q))
    assert.deepEqual(withoutTime(await preview(admin,{...selection(detail),items:selection(detail).items.reverse()})),withoutTime(all))
    assert.equal(await financialState(),before);browserSale={...detail,items:[item,...detail.items.filter(i=>i!==item)]}
  }
  checks.push('wallet/cash/split, one-won sale discount, partial quantities, mixed disposition, stable input ordering, replay and full-selection equivalence')
  phase='fractional-lots'
  const product=await request(admin,'/api/management',{kind:'PRODUCT',action:'CREATE_PRODUCT',requestKey:randomUUID(),sku:'PREVIEW-FRACTION',name:'Preview fractional cost item',category:'QA',sellingPriceWon:1001,reorderLevel:0,reason:'Synthetic preview product fixture',verified:true})
  const productId=product.target_id
  const day=(await owner.query("select (now() at time zone 'Asia/Seoul')::date::text as business_date")).rows[0].business_date
  for(const [quantity,purchaseUnitCostWon] of [[2,100],[3,201]])await request(admin,'/api/inventory/receipts',{supplierName:'Synthetic supplier',supplierInvoice:randomUUID(),purchaseDate:day,shippingWon:1,otherCostsWon:0,discountWon:0,notes:'Synthetic preview fixture',idempotencyKey:randomUUID(),lines:[{productId,quantity,purchaseUnitCostWon}]},201)
  const multi=await sale('CASH',[{productId,quantity:3}],'PREVIEWONE'),multiInput=selection(multi)
  const original=await assertQuote(multi,multiInput)
  const productRecord=(await request(admin,`/api/management?kind=PRODUCT&status=ACTIVE&targetId=${productId}`)).records[0]
  await request(admin,'/api/management',{kind:'PRODUCT',action:'CHANGE_PRODUCT_PRICE',targetId:productId,expectedUpdatedAt:productRecord.updated_at,sellingPriceWon:2001,reason:'Changed after original sale verified',verified:true,requestKey:randomUUID()})
  assert.deepEqual(withoutTime(await preview(admin,multiInput)),withoutTime(original))
  const lot=(await owner.query('select c.inventory_lot_id from private.sale_cost_allocations c join private.sale_items i on i.id=c.sale_item_id where i.sale_id=$1 order by c.created_at,c.id limit 1',[multi.sale_id])).rows[0].inventory_lot_id
  await owner.query("update private.inventory_lots set expiration_date='2000-01-01' where id=$1",[lot])
  before=await financialState();assert.equal((await preview(admin,multiInput)).outcome,'EXPIRED_STOCK')
  await assertQuote(multi,{...multiInput,items:multiInput.items.map(i=>({...i,restock_quantity:0,write_off_quantity:i.restock_quantity}))})
  assert.equal(await financialState(),before);checks.push('fractional-cost multi-lot allocation, current-price independence and expired restock denial without altering stock')
  phase='zero-net'
  await request(admin,'/api/coupons',{name:'Free fixture',code:'PREVIEWFREE',discountType:'PERCENTAGE',fixedAmountWon:null,percentageBps:10000,minimumSubtotalWon:0,maxDiscountWon:null,totalRedemptionLimit:null,perStudentLimit:null,startsAt:new Date(Date.now()-60000).toISOString(),endsAt:null,idempotencyKey:randomUUID()},201)
  const free=await sale('WALLET',[{productId:water.id,quantity:1}],'PREVIEWFREE'),freeQuote=await assertQuote(free,selection(free));assert.equal(freeQuote.refund_won,0)
  checks.push('zero-net discounted sale retains quantity/cost inspection and produces zero wallet/cash estimate')
  phase='online-state'
  const room=(await request(customer,'/api/store/locations')).find(r=>r.room==='201')
  const order=await request(customer,'/api/store/orders',{items:[{productId:water.id,quantity:1}],deliveryLocationId:room.location_id,idempotencyKey:randomUUID(),expectedTotalWon:1200},201)
  const online=await request(admin,`/api/refunds/sale?reference=${order.order_number}`),onlineInput=selection(online)
  assert.equal((await preview(admin,onlineInput)).outcome,'INELIGIBLE')
  for(const status of ['PICKING','READY','OUT_FOR_DELIVERY','DELIVERED']){
    await request(cashier,`/api/orders/${order.order_id}/status`,{status})
    assert.equal((await preview(admin,onlineInput)).outcome,['OUT_FOR_DELIVERY','DELIVERED'].includes(status)?'PREVIEW':'INELIGIBLE')
  }
  checks.push('pre-dispatch partial cancellation is not offered; dispatched/delivered return estimates use the same original-sale allocation')
  phase='acl-and-malformed-sql'
  const runtime=new pg.Client({connectionString:ctx.runtimeUrl});await runtime.connect()
  try{await assert.rejects(()=>runtime.query('select private.refund_proportional_slice(10,3,0,1)'),e=>e.code==='42501');await assert.rejects(()=>runtime.query('select * from private.refund_allocations'),e=>e.code==='42501')}finally{await runtime.end()}
  for(const bad of [null,{},[null],[{}],[{...input.items[0],restock_quantity:'1'}],[{...input.items[0],restock_quantity:1.5}],[{...input.items[0],write_off_quantity:null}],[{...input.items[0],unexpected:true}],[input.items[0],input.items[0]]]){
    await assert.rejects(()=>owner.query('select private.partial_refund_preview_document($1,$2::jsonb)',[first.sale_id,JSON.stringify(bad)]),e=>e.message==='BAD_REQUEST')
  }
  checks.push('runtime cannot call private helpers or read journals; direct SQL rejects malformed/null/duplicate/extra-field selection')
  phase='concurrent-full-refund'
  await ctx.start(true,{partialPreview:true});admin=await login('9001',admin);await owner.query('update private.system_settings set refunds_enabled=true where singleton')
  const other=await login('9101'),raceSale=await sale('CASH',[{productId:water.id,quantity:1}]),raceInput=selection(raceSale)
  before=await financialState();await request(admin,'/api/refunds',raceInput,400);assert.equal(await financialState(),before)
  const [estimate,posted]=await Promise.all([preview(admin,raceInput),request(other,'/api/refunds',{saleId:raceSale.sale_id,idempotencyKey:randomUUID(),reasonCode:'OTHER',notes:'Synthetic existing full-refund race',verified:true,items:raceSale.items.map(i=>({sale_item_id:i.sale_item_id,disposition:'RESTOCK'}))})])
  assert.ok(['PREVIEW','ALREADY_REFUNDED'].includes(estimate.outcome));assert.equal(posted.outcome,'COMPLETED')
  assert.equal((await preview(admin,raceInput)).outcome,'ALREADY_REFUNDED')
  assert.equal(Number((await owner.query('select count(*) from private.sale_refunds where sale_id=$1',[raceSale.sale_id])).rows[0].count),1)
  checks.push('preview payload cannot post; concurrent full refund leaves one original authoritative refund and subsequent preview fails closed')
  phase='browser';before=await financialState();await runRefundPreviewBrowser(ctx,admin,browserSale);assert.equal(await financialState(),before)
  checks.push('four-width browser calculation, invalidation, combined-quantity rejection and retry leave all financial/roster/audit tables unchanged')
  fs.mkdirSync('.validation/refund-preview',{recursive:true});fs.writeFileSync('.validation/refund-preview/results.json',JSON.stringify({checks,mathCases,liveDataUsed:false,postingImplemented:false},null,2))
  console.log(`Refund preview passed: ${checks.length} acceptance groups, ${mathCases} exact arithmetic cases; no live data.`)
}catch(e){fs.mkdirSync('.validation/refund-preview',{recursive:true});fs.writeFileSync('.validation/refund-preview/failure.txt',`Phase: ${phase}\n${e?.stack??'unknown'}`);console.error(`Refund preview failed at ${phase}: ${e?.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}

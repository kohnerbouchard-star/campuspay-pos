// Actual application pages with synthetic API responses; disposable localhost DB for login only.
// Mutations below are intercepted in the browser and never reach application/database writers.
import assert from 'node:assert/strict'
import fs from 'node:fs/promises'
import { chromium, expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
const directory = '.validation/workflow-states', checks = [], screenshots = []
const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`
const timestamp = '2026-10-08T01:00:00Z'
const gate = () => { let release; const promise = new Promise(resolve => { release = resolve }); return { promise, release } }
const receipt = n => ({ operation_id:id(n), request_key:id(n+100), reference_number:`FUND-UI-${n}`, action:'NONCASH_CREDIT', wallet_delta_won:1000, cash_delta_won:0, cash_received_won:0, change_won:0, balance_before_won:0, balance_after_won:1000, student_code:'UI-STUDENT', student_name:'Synthetic workflow student', shift_id:null, terminal_id:id(800), terminal_label:'Synthetic register', actor_name:'Synthetic operator', approver_name:'Synthetic approver', source_reference:'Synthetic source', notes:'Synthetic evidence for browser review only', created_at:timestamp, original_reference:null, reversed_by_reference:null })
const shift = n => ({ shift_id:id(n+200), terminal_id:id(800), terminal_label:'Synthetic register', opened_by:id(801), opened_at:timestamp, closed_at:timestamp, closed_by:id(801), opening_float_won:1000, cash_sales_won:0, cash_payouts_won:0, funding_in_won:0, funding_out_won:0, expected_won:1000, counted_won:900, variance_won:-100, close_notes:'Synthetic physical count discrepancy', approved_by:null, approval_notes:null, review_required:true })
let ctx, browser, phase = 'setup'
await fs.mkdir(directory, { recursive:true })
await Promise.all(['results.json','failure.txt'].map(file=>fs.rm(`${directory}/${file}`,{force:true})))
try {
  ctx = await refundTestContext(); await ctx.start(false)
  const admin = await ctx.login()
  const linkedStudent = (await ctx.owner.query('select id from private.students where active order by id limit 1')).rows[0].id
  browser = await chromium.launch({ headless:true })
  for (const width of [1440,390]) {
    const context = await browser.newContext({ viewport:{width,height:950} })
    await context.addCookies([...admin].filter(([,value])=>value).map(([name,value])=>({name,value,url:ctx.base})))
    const page = await context.newPage(), errors = [], writes = []
    page.setDefaultTimeout(10000); page.on('pageerror',error=>errors.push(error.message))
    const orders = Array.from({length:12},(_,i)=>({order_id:id(i+1),order_number:`ORDER-UI-${i+1}`,status:'PLACED',student_name:`Synthetic student ${i+1}`,total_won:1000,delivery_building:'East Building',delivery_floor:2,delivery_room:'201',delivery_note:null,items:[{product_id:id(100),name:'Synthetic item',quantity:1,unit_price_won:1000,line_total_won:1000}],created_at:timestamp,timeline:[]}))
    const students = Array.from({length:12},(_,i)=>({student_id:id(i+1),student_code:`STUDENT-UI-${i+1}`,display_name:`Synthetic student ${i+1}`,active:true,card_active:true,pin_locked_until:null}))
    let orderFailures = 1, loseAdvance = false, historyFailures = 1, policyFailures = 1, fundingFailures = 1, couponFailures = 1, reconciliationFailures = 1, discrepancy = false
    const heldOrder = gate(), heldCoupon = gate()
    let holdAdvance = false, couponDirectoryFailures = 0, holdCouponReload = false
    const coupon = {coupon_id:id(850),name:'Synthetic review coupon',code_masked:'SYN…',discount_type:'FIXED',fixed_amount_won:100,percentage_bps:null,minimum_subtotal_won:0,max_discount_won:null,total_redemption_limit:null,per_student_limit:null,redemption_count:0,discount_given_won:0,starts_at:timestamp,ends_at:null,active:true,created_at:timestamp}
    const reportFailures = new Set(['/api/reports/inventory','/api/reports/wallets'])
    let policy = {terminal_label:'Synthetic register',cash_enabled:false,event_name:null,can_manage:true,ends_at:null,event_status:'OFF'}
    const success = (route,data) => route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})})
    const failure = route => route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'UNAVAILABLE',message:'Synthetic service temporarily unavailable'}})})
    await context.route('**/api/**', async route => {
      const request=route.request(),url=new URL(request.url()),path=url.pathname
      if(path==='/api/auth/activity')return success(route,{expiresAt:new Date(Date.now()+900000).toISOString()})
      if(path==='/api/orders') { if(orderFailures>0){orderFailures--;return failure(route)} return success(route,orders) }
      if(/^\/api\/orders\/[^/]+\/status$/.test(path)) {
        writes.push(path); const order=orders.find(row=>row.order_id===path.split('/')[3]);order.status=request.postDataJSON().status
        if(holdAdvance)await heldOrder.promise
        if(loseAdvance){loseAdvance=false;orderFailures=1;return route.abort('failed')}
        return success(route,{order_id:order.order_id,order_number:order.order_number,status:order.status,updated_at:timestamp})
      }
      if(path==='/api/coupons'){if(holdCouponReload)await heldCoupon.promise;if(couponDirectoryFailures>0){couponDirectoryFailures--;return failure(route)}return success(route,[coupon])}
      if(path===`/api/coupons/${coupon.coupon_id}/deactivate`){writes.push(path);coupon.active=false;couponDirectoryFailures=1;holdCouponReload=true;return success(route,coupon)}
      if(path==='/api/security/students')return success(route,students.filter(row=>`${row.display_name} ${row.student_code}`.toLowerCase().includes((url.searchParams.get('q')??'').toLowerCase())))
      if(path==='/api/security/step-up'){writes.push(path);return success(route,{authorizationToken:id(999),expiresAt:new Date(Date.now()+60000).toISOString()})}
      if(path==='/api/funding'){if(fundingFailures>0){fundingFailures--;return failure(route)}return success(route,{enabled:false,required:false,finance_access:true,from:'2026-10-08',to:'2026-10-08',offset:0,total:12,wallet_net_won:12000,cash_in_won:0,cash_out_won:0,rows:Array.from({length:12},(_,i)=>receipt(i+1)),wallets_checked:12,wallet_mismatches:0,closed_shifts_checked:0,closed_shift_mismatches:0,unreviewed_variances:0,unresolved_requests:0})}
      if(path==='/api/reports/inventory'||path==='/api/reports/wallets'){if(reportFailures.delete(path))return failure(route);return success(route,[])}
      if(path==='/api/reconciliation'){if(reconciliationFailures>0){reconciliationFailures--;return failure(route)}return success(route,{business_date:url.searchParams.get('day'),timezone:'Asia/Seoul',generated_at:timestamp,activity_count:0,status:discrepancy?'DISCREPANCIES':'NO_POSTED_ACTIVITY',metrics:[],checks:[{code:'SYNTHETIC_CHECK',label:'Synthetic journal check',checked_count:1,discrepancies:discrepancy?1:0}]})}
      if(path==='/api/reports/coupons'){if(couponFailures>0){couponFailures--;return failure(route)}return success(route,[])}
      if(path==='/api/cash/history') {
        if(historyFailures>0){historyFailures--;return failure(route)}
        return success(route,{from:null,to:null,query:'',offset:0,total:12,generated_at:timestamp,scope:'ALL_TERMINALS',opening_float_won:12000,expected_won:12000,counted_won:10800,variance_won:-1200,unreviewed:12,rows:Array.from({length:12},(_,i)=>({shift:shift(i+1),opened_by_name:'Synthetic opener',closed_by_name:'Synthetic closer',approved_by_name:null}))})
      }
      if(path==='/api/cash')return success(route,{enabled:false,accountant_cash_enabled:false,terminal_id:id(800),current_shift:null,closed_shifts:Array.from({length:12},(_,i)=>shift(i+1)),total_closed:12})
      if(path==='/api/pos/payment-policy'){
        if(request.method()==='POST'){writes.push(path);const input=request.postDataJSON();policy={...policy,cash_enabled:input.cashEnabled,event_name:input.eventName,ends_at:input.endsAt,event_status:input.cashEnabled?'ACTIVE':'OFF'};return success(route,policy)}
        if(policyFailures>0){policyFailures--;return failure(route)}return success(route,policy)
      }
      if(request.method()!=='GET'){writes.push('UNEXPECTED '+path);return route.abort('blockedbyclient')}
      return route.continue()
    })
    async function capture(name){assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),`${name} document fits`);const file=`${name}-${width}.png`;await page.screenshot({path:`${directory}/${file}`,fullPage:false});screenshots.push(file)}
    async function firstColumnAction(locator){const box=await locator.boundingBox();assert.ok(box&&box.x>=0&&box.x+box.width<=width, 'Action is reachable without horizontal scrolling')}
    try {
      phase=`orders ${width}`
      await page.goto(ctx.base+'/orders');await expect(page.locator('main').getByRole('alert')).toContainText('Orders could not be loaded')
      await expect(page.getByRole('heading',{name:'All caught up',exact:true})).toHaveCount(0)
      await page.getByRole('button',{name:'Refresh queue',exact:true}).click()
      const select=page.locator('#order-select-'+id(12));await select.focus();await select.press('Enter')
      const detail=page.getByRole('region',{name:'ORDER-UI-12',exact:true})
      await expect(detail.getByRole('heading',{name:'ORDER-UI-12',exact:true})).toBeFocused();await capture('order-detail')
      await detail.getByRole('button',{name:'Back to order queue',exact:true}).click();await expect(select).toBeFocused()
      await select.click();loseAdvance=true
      await detail.getByRole('button',{name:'Start picking',exact:true}).evaluate(button=>{button.click();button.click()})
      await expect(page.locator('main').getByRole('alert')).toContainText('Orders could not be loaded')
      assert.equal(writes.filter(path=>path.includes('/status')).length,1)
      await expect(detail.getByRole('button',{name:'Updating order…',exact:true})).toBeDisabled()
      await page.getByRole('button',{name:'Refresh queue',exact:true}).click()
      await expect(detail.getByRole('button',{name:'Mark ready for delivery',exact:true})).toBeDisabled()
      await detail.getByRole('checkbox').check()
      await expect(detail.getByRole('button',{name:'Mark ready for delivery',exact:true})).toBeEnabled()
      assert.equal(writes.filter(path=>path.includes('/status')).length,1)
      holdAdvance=true
      await detail.getByRole('button',{name:'Mark ready for delivery',exact:true}).click()
      await expect.poll(()=>writes.filter(path=>path.includes('/status')).length).toBe(2)
      await detail.getByRole('button',{name:'Back to order queue',exact:true}).click();await expect(select).toBeFocused()
      await expect(detail.getByRole('checkbox')).toBeChecked()
      await page.locator('#order-select-'+id(1)).click()
      const nextDetail=page.getByRole('region',{name:'ORDER-UI-1',exact:true})
      await expect(nextDetail.getByRole('heading',{name:'ORDER-UI-1',exact:true})).toBeFocused()
      await expect(nextDetail.getByRole('button',{name:'Updating order…',exact:true})).toBeDisabled()
      heldOrder.release()
      await expect(nextDetail.getByRole('button',{name:'Start picking',exact:true})).toBeEnabled()
      await expect(nextDetail.getByRole('heading',{name:'ORDER-UI-1',exact:true})).toBeFocused()
      assert.equal(writes.filter(path=>path.includes('/status')).length,2)
      const orderSearch=page.getByRole('searchbox',{name:'Search orders, students, or rooms',exact:true})
      await orderSearch.fill('ORDER-UI-2');await expect(orderSearch).toBeFocused()
      await expect(page.getByRole('region',{name:'ORDER-UI-2',exact:true})).toBeVisible()
      checks.push(`${width}px order selection focuses detail and returns to queue; failed refresh blocks advance; duplicate/lost update requires GET recovery; held update retains its lock/picking state on Back and cannot steal focus from another selected order`)

      phase=`security ${width}`
      await page.goto(ctx.base+'/security')
      await page.getByRole('searchbox',{name:'Search students',exact:true}).fill('STUDENT-UI-12')
      const student=page.locator('#security-student-'+id(12));await student.click()
      await expect(page.getByRole('heading',{name:'PIN and card replacement',exact:true})).toBeFocused();await capture('security-selected')
      await page.getByRole('textbox',{name:'Approving employee ID',exact:true}).fill('SYNTHETIC')
      await page.getByLabel('Approving employee PIN',{exact:true}).fill('123456')
      await page.getByRole('button',{name:'Authorize protected action',exact:true}).click()
      await page.getByLabel('Student enters new PIN',{exact:true}).fill('654321')
      await page.getByRole('button',{name:'Back to student search',exact:true}).click()
      await expect(student).toBeFocused();await expect(page.getByRole('searchbox',{name:'Search students',exact:true})).toHaveValue('STUDENT-UI-12')
      await student.click();await expect(page.getByLabel('Approving employee PIN',{exact:true})).toHaveValue('')
      await expect(page.getByLabel('Student enters new PIN',{exact:true})).toHaveCount(0)
      await page.getByRole('searchbox',{name:'Search students',exact:true}).fill('NO-MATCH')
      await expect(student).toHaveCount(0)
      await page.getByRole('button',{name:'Back to student search',exact:true}).click()
      await expect(page.getByRole('searchbox',{name:'Search students',exact:true})).toBeFocused()
      await page.goto(ctx.base+'/security?studentId='+linkedStudent)
      await expect(page.getByRole('heading',{name:'PIN and card replacement',exact:true})).toBeFocused()
      await page.getByRole('button',{name:'Back to student search',exact:true}).click()
      await expect(page.getByRole('searchbox',{name:'Search students',exact:true})).toBeFocused()
      assert.equal(writes.filter(path=>path.includes('/security/')).length,1)
      checks.push(`${width}px security selection/return preserves search and focus; missing-row and direct-link returns focus search; leaving an unsubmitted approval clears PIN and authorization with no credential-reset request`)

      phase=`funding receipt ${width}`
      await page.goto(ctx.base+'/funding');await expect(page.locator('main').getByRole('alert')).toContainText('Synthetic service')
      await page.getByRole('button',{name:'Try again',exact:true}).click()
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0)
      const openReceipt=page.getByRole('button',{name:'View receipt FUND-UI-1',exact:true});await firstColumnAction(openReceipt);await openReceipt.click()
      const receiptDialog=page.getByRole('dialog',{name:'Funding receipt details',exact:true});await expect(receiptDialog).toContainText('FUND-UI-1');await capture('funding-receipt')
      await page.keyboard.press('Escape');await expect(openReceipt).toBeFocused()
      checks.push(`${width}px funding receipt is reachable in the first table column and opens a keyboard-dismissable focused dialog with return to its record`)

      phase=`cash archive ${width}`
      await page.goto(ctx.base+'/cash/history');await expect(page.locator('main').getByRole('alert')).toContainText('Synthetic service')
      await page.getByRole('button',{name:'Try again',exact:true}).click()
      const closeDetails=page.getByRole('button',{name:'View close details',exact:true}).first();await firstColumnAction(closeDetails);await closeDetails.click()
      const closeDialog=page.getByRole('dialog',{name:'Cash close details',exact:true});await expect(closeDialog).toContainText('Synthetic physical count discrepancy');await capture('cash-close-detail')
      await page.keyboard.press('Escape');await expect(closeDetails).toBeFocused()
      await page.getByLabel('From (Korea)',{exact:true}).fill('2026-10-08');await page.getByRole('button',{name:'Apply history filters',exact:true}).click()
      await expect(page.locator('main').getByRole('alert').filter({hasText:'Choose both dates'})).toBeVisible()
      checks.push(`${width}px cash archive failure/retry, close dialog, first-column action and invalid-date feedback preserve a clear return`)

      phase=`variance review ${width}`
      await page.goto(ctx.base+'/cash')
      const variance=page.getByRole('button',{name:'Review variance',exact:true}).first();await firstColumnAction(variance);await variance.click()
      await expect(page.getByRole('heading',{name:'Review cash variance',exact:true})).toBeFocused()
      await page.getByLabel('Review evidence and approval notes',{exact:true}).fill('Synthetic review draft without submission')
      await capture('variance-review');await page.getByRole('button',{name:'Cancel review',exact:true}).click();await expect(variance).toBeFocused()
      assert.equal(writes.filter(path=>path.startsWith('/api/cash')).length,0)
      checks.push(`${width}px cash variance review focuses the selected form and cancel returns to the record without posting`)

      phase=`payment settings ${width}`
      await page.goto(ctx.base+'/settings/payments');await expect(page.locator('main').getByRole('alert')).toContainText('Synthetic service')
      await page.getByRole('button',{name:'Try again',exact:true}).click()
      await page.getByRole('textbox',{name:'Event name',exact:true}).fill('Synthetic local event')
      await page.getByRole('button',{name:'Set end time to one hour from now',exact:true}).click()
      await page.getByRole('button',{name:'Enable event cash and split payments',exact:true}).evaluate(button=>{button.click();button.click()})
      await expect(page.getByRole('status').filter({hasText:'Cash and split payments are now on for this register.'})).toBeVisible();await capture('payment-settings-saved')
      assert.equal(writes.filter(path=>path==='/api/pos/payment-policy').length,1)
      await page.getByRole('button',{name:'Turn off cash and split payments',exact:true}).click()
      await expect(page.getByRole('status').filter({hasText:'Cash and split payments are now off for this register.'})).toBeVisible()
      checks.push(`${width}px payment settings loading failure/retry and enable/disable expose confirmed register-scoped feedback; synchronous double-click sends one mocked save`)
      phase=`coupon confirmed refresh ${width}`
      await page.goto(ctx.base+'/coupons')
      await page.getByRole('button',{name:'Deactivate',exact:true}).click()
      const deactivate=page.getByRole('dialog',{name:'Deactivate Synthetic review coupon?',exact:true})
      await deactivate.getByRole('textbox',{name:'Reason for deactivation',exact:true}).fill('Synthetic review deactivation')
      await deactivate.getByRole('button',{name:'Deactivate coupon',exact:true}).evaluate(button=>{button.click();button.click()})
      const confirmed=page.getByRole('status').filter({hasText:'Synthetic review coupon was deactivated.'})
      await expect(confirmed).toBeFocused()
      await expect(page.getByRole('status').filter({hasText:'Loading coupon directory…'})).toBeVisible()
      heldCoupon.release()
      await expect(page.getByRole('button',{name:'Retry coupon directory',exact:true})).toBeVisible()
      await expect(confirmed).toBeVisible();await expect(confirmed).toBeFocused()
      await page.getByRole('button',{name:'Retry coupon directory',exact:true}).click()
      await expect(page.getByRole('cell',{name:'Inactive',exact:true})).toBeVisible()
      await expect(confirmed).toBeFocused();await expect(page.getByRole('button',{name:'Deactivate',exact:true})).toHaveCount(0)
      assert.equal(writes.filter(path=>path.endsWith('/deactivate')).length,1)
      await capture('coupon-confirmed-refresh')
      checks.push(`${width}px confirmed coupon deactivation survives delayed and failed directory refresh; retry is GET-only and one submit is preserved`)

      phase=`coupon report ${width}`
      await page.goto(ctx.base+'/reports?report=coupon-report')
      await expect(page.locator('main').getByRole('alert')).toContainText('Synthetic service')
      await expect(page.getByText('No coupon activity recorded.',{exact:true})).toHaveCount(0)
      await page.getByRole('button',{name:'Try again',exact:true}).click()
      await expect(page.getByText('No coupon activity recorded.',{exact:true})).toBeVisible()
      await expect(page.locator('main').getByRole('alert')).toHaveCount(0);await capture('coupon-report-empty')
      checks.push(`${width}px coupon report failure is not represented as zero activity; GET retry exposes the real empty result`)
      phase=`balance reports ${width}`
      for(const report of ['inventory-report','wallet-report']){
        await page.goto(ctx.base+'/reports?report='+report)
        await expect(page.locator('main').getByRole('alert')).toContainText('This report could not be loaded')
        await page.getByRole('button',{name:'Try again',exact:true}).click()
        await expect(page.getByText('No report entries yet',{exact:true})).toBeVisible()
      }
      checks.push(`${width}px inventory and wallet reports distinguish a failed read from a confirmed empty result and allow GET-only retry`)
      phase=`reconciliation ${width}`
      await page.goto(ctx.base+'/reconciliation')
      await expect(page.locator('main').getByRole('alert')).toContainText('Synthetic service')
      await page.getByRole('button',{name:'Try again',exact:true}).click()
      await expect(page.getByRole('heading',{name:'No posted activity for this date',exact:true})).toBeVisible()
      discrepancy=true;await page.getByRole('button',{name:'Review selected day',exact:true}).click()
      await expect(page.getByRole('heading',{name:'Recorded data needs reconciliation',exact:true})).toBeVisible()
      await expect(page.getByRole('region',{name:'Journal integrity checks',exact:true})).toContainText('1 — review required')
      await expect(page.getByText('How to interpret this reconciliation',{exact:true})).toBeVisible()
      assert.equal(await page.locator('details').evaluate(node=>node.open),false)
      await capture('reconciliation-discrepancy')
      checks.push(`${width}px reconciliation retry distinguishes no activity from discrepancies; critical checks remain visible while guidance is collapsed`)
      assert.deepEqual(errors,[]);assert.deepEqual(writes.filter(path=>path.startsWith('UNEXPECTED')),[])
    } finally { heldOrder.release(); heldCoupon.release(); await context.close() }
  }
  await fs.writeFile(`${directory}/results.json`,JSON.stringify({result:'PASS',checks,screenshots,mutations:'Browser-intercepted synthetic responses only'},null,2))
  console.log(`Workflow state acceptance passed: ${checks.length} groups; ${screenshots.length} screenshots.`)
} catch(error) {await fs.writeFile(`${directory}/failure.txt`,`${phase}\n${String(error)}`);throw error}
finally {await browser?.close();await ctx?.close()}

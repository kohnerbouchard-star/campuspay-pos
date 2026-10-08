import assert from 'node:assert/strict'
import { chromium, expect } from '@playwright/test'

export async function auditRefundBrowser(ctx,admin,refund) {
 const browser=await chromium.launch({headless:true}),errors=[]
 try {
  const context=await browser.newContext({viewport:{width:390,height:900}})
  await context.addCookies([...admin].filter(([,value])=>value).map(([name,value])=>({name,value,url:ctx.base})))
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(10000)
  await page.goto(ctx.base+'/refunds')
  await page.getByLabel('Receipt or online order number',{exact:true}).fill(refund.receipt_number)
  await page.getByRole('button',{name:'Find sale',exact:true}).click()
  await expect(page.getByRole('heading',{name:'Refund recorded',exact:true})).toBeVisible()
  await expect(page.getByText('Open an authorized cash drawer at this register before proceeding. Do not hand over cash yet.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Record cash paid',exact:true})).toHaveCount(0)
  await page.screenshot({path:'.validation/audit-fixes/closed-drawer-390.png',fullPage:true})
  let payoutPosts=0
  page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/refunds/payout')payoutPosts++})
  await page.route('**/api/refunds/cash-readiness?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic unavailable readiness'}})}),{times:1})
  await page.getByRole('button',{name:'Check cash readiness',exact:true}).click()
  await expect(page.getByText('Cash readiness could not be confirmed. Refresh before proceeding; do not hand over cash.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Record cash paid',exact:true})).toHaveCount(0)
  await ctx.request(admin,'/api/cash/open',{requestKey:crypto.randomUUID(),counts:{'10000':2},verified:true})
  await page.getByRole('button',{name:'Check cash readiness',exact:true}).click()
  await expect(page.getByRole('button',{name:'Record cash paid',exact:true})).toBeVisible()
  await page.getByLabel('Cash handover reference',{exact:true}).fill('Synthetic browser handover')
  await page.getByRole('checkbox',{name:/I verified that this exact cash amount/}).check()
  await page.route('**/api/refunds/payout',async route=>{const r=await route.fetch();assert.equal(r.status(),200);await route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic lost response'}})})},{times:1})
  await page.getByRole('button',{name:'Record cash paid',exact:true}).click()
  await expect(page.getByText('Payout recording is unconfirmed. Refresh the authoritative status. Do not hand over cash again.',{exact:true})).toBeVisible()
  await page.getByRole('button',{name:'Refresh payout status',exact:true}).click()
  await expect(page.getByText('Cash payout recorded: Synthetic browser handover. Do not pay again.',{exact:true})).toBeVisible()
  await expect(page.getByRole('button',{name:'Record cash paid',exact:true})).toHaveCount(0)
  assert.equal(payoutPosts,1);assert.deepEqual(errors,[])
  await page.screenshot({path:'.validation/audit-fixes/payout-recovered-390.png',fullPage:true})
  return 'Browser: closed/unavailable readiness blocks handover; refresh enables it; lost response recovers one payout'
 } finally {await browser.close()}
}

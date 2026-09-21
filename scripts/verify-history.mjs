#!/usr/bin/env node
// Isolated localhost acceptance. Financial fixtures use authenticated existing
// APIs; report verification never edits journals or weakens their guards.
import assert from 'node:assert/strict'
import { randomBytes,randomUUID } from 'node:crypto'
import fs from 'node:fs'
import { chromium,expect } from '@playwright/test'
import { refundTestContext } from './refund-test-context.mjs'
let ctx,phase='setup',browser;const checks=[]
try{
 ctx=await refundTestContext();await ctx.start(false,{cash:true})
 const {owner,request,login,pin}=ctx,admin=await login(),accountant=await login('3001'),cashier=await login('1001'),inventory=await login('2001')
 const code='HISTORY-'+randomUUID().slice(0,8),card='HISTORY'+randomBytes(12).toString('hex'),name='History QA student'
 await request(admin,'/api/students',{studentCode:code,displayName:name,cardRead:card,pin,confirmationPin:pin,idempotencyKey:randomUUID()},201)
 const student=(await owner.query('select id from private.students where student_code=$1',[code])).rows[0].id
 const walletUrl=`/api/accounting/students/${student}/history`
 const day=(await owner.query("select (clock_timestamp() at time zone 'Asia/Seoul')::date::text day")).rows[0].day
 const footprint=async()=>JSON.stringify((await owner.query("select (select md5(string_agg(to_jsonb(l)::text,'' order by l.id)) from private.wallet_ledger l) ledger,(select md5(string_agg(to_jsonb(w)::text,'' order by w.student_id)) from private.wallets w) wallets,(select md5(string_agg(to_jsonb(c)::text,'' order by c.shift_id)) from private.cash_shift_closes c) closes")).rows[0])
 phase='wallet fixture'
 for(let n=0;n<101;n++){
  const last=n===100,intent=await request(accountant,'/api/accounting/intents',{direction:last?'DEBIT':'CREDIT',denominations:[1000],reasonCode:last?'PURCHASE_CORRECTION':'FUNDS_RECEIVED',notes:last?'Unique history deduction':'Synthetic historical funding receipt',idempotencyKey:randomUUID()},201)
  await request(accountant,`/api/accounting/intents/${intent.intent_id}/card`,{cardRead:card})
  await request(accountant,`/api/accounting/intents/${intent.intent_id}/confirm`,{pin})
 }
 phase='wallet history';const before=await footprint(),pages=[]
 for(const offset of [0,50,100])pages.push(await request(accountant,`${walletUrl}?offset=${offset}`))
 assert.deepEqual(pages.map(p=>p.rows.length),[50,50,1]);assert.ok(pages.every(p=>p.total===101&&p.net_amount_won===99000&&p.balance_won===99000&&p.reconciliation_difference_won===0))
 assert.equal(new Set(pages.flatMap(p=>p.rows.map(r=>r.ledger_id))).size,101)
 assert.equal((await request(accountant,`${walletUrl}?q=Unique%20history%20deduction`)).total,1)
 assert.equal((await request(accountant,`${walletUrl}?from=${day}&to=${day}`)).total,101)
 await request(accountant,`${walletUrl}?from=${day}`,undefined,400);await request(accountant,`${walletUrl}?offset=-1`,undefined,400)
 for(const who of [cashier,inventory,new Map()])await request(who,walletUrl,undefined,who.size?403:401)
 async function exportCsv(who,path){const cookie=[...who].map(([k,v])=>`${k}=${v}`).join('; '),r=await fetch(ctx.base+path,{headers:{cookie}});assert.equal(r.status,200);assert.match(r.headers.get('cache-control'),/no-store/);return r.text()}
 const walletCsv=await exportCsv(accountant,walletUrl+'/export');assert.equal(walletCsv.trimEnd().split('\r\n').length,102);assert.ok(walletCsv.includes('"-1000"'))
 const demo=(await owner.query("select id from private.students where student_code='STU001'")).rows[0].id
 assert.equal((await request(accountant,`/api/accounting/students/${demo}/history`)).reconciliation_difference_won,20000)
 assert.equal(await footprint(),before)
 checks.push('101 journal-backed wallet entries in 50/50/1 pages, scoped totals/full CSV, role denials and the demo opening mismatch surfaced without edits')
 phase='cash fixture';await owner.query('update private.system_settings set cash_controls_enabled=true where singleton')
 for(let n=0;n<52;n++){
  const who=n<51?cashier:admin,shift=await request(who,'/api/cash/open',{requestKey:randomUUID(),counts:{'1000':0},verified:true})
  await request(who,'/api/cash/close',{requestKey:randomUUID(),shiftId:shift.shift_id,counts:{'1000':0},notes:'Synthetic zero-float close for history',verified:true})
 }
 phase='cash history';const beforeReports=await footprint()
 const cash=await request(accountant,'/api/cash/history'),cashLast=await request(accountant,'/api/cash/history?offset=50'),own=await request(cashier,'/api/cash/history')
 assert.equal(cash.total,52);assert.equal(cash.rows.length,50);assert.equal(cashLast.rows.length,2);assert.equal(own.total,51);assert.equal(own.scope,'CURRENT_TERMINAL')
 const ownTerminal=own.rows[0].shift.terminal_id;assert.ok(own.rows.every(r=>r.shift.terminal_id===ownTerminal))
 assert.equal((await request(accountant,`/api/cash/history?q=${ownTerminal}`)).total,51)
 await request(inventory,'/api/cash/history',undefined,403);await request(new Map(),'/api/cash/history',undefined,401)
 const cashCsv=await exportCsv(accountant,'/api/cash/history/export?offset=50');assert.equal(cashCsv.trimEnd().split('\r\n').length,53)
 const ownCsv=await exportCsv(cashier,'/api/cash/history/export');assert.equal(ownCsv.trimEnd().split('\r\n').length,52)
 assert.equal(await footprint(),beforeReports)
 checks.push('52 closed shifts across pages, all-filter export independent of page, and cashier-only terminal scope')
 phase='browser';browser=await chromium.launch({headless:true});const context=await browser.newContext(),page=await context.newPage(),errors=[]
 page.on('pageerror',e=>errors.push(e.message));await context.addCookies([...accountant].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
 await page.goto(ctx.base+'/accounting');await page.getByLabel('Search name or student ID',{exact:true}).fill(code)
 await page.getByRole('row').filter({hasText:name}).getByRole('button',{name:'View history',exact:true}).click()
 const dialog=page.getByRole('dialog',{name:`${name} · Wallet history`,exact:true})
 await expect(dialog.getByText('1–50 of 101',{exact:true})).toBeVisible()
 await dialog.getByRole('button',{name:'Next history page',exact:true}).click();await expect(dialog.getByText('51–100 of 101',{exact:true})).toBeVisible()
 await dialog.getByRole('button',{name:'Next history page',exact:true}).click();await expect(dialog.getByText('101–101 of 101',{exact:true})).toBeVisible()
 fs.mkdirSync('.validation/history',{recursive:true})
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`.validation/history/wallet-${width}.png`})}
 await dialog.getByRole('button',{name:'Close dialog',exact:true}).click()
 await page.goto(ctx.base+'/cash/history');await expect(page.getByText('1–50 of 52',{exact:true})).toBeVisible()
 await page.getByRole('button',{name:'Next history page',exact:true}).click();await expect(page.getByText('51–52 of 52',{exact:true})).toBeVisible()
 await expect(page.getByRole('link',{name:'Export all matching cash closes',exact:true})).toBeVisible()
 for(const width of [1440,1024,768,390]){await page.setViewportSize({width,height:900});assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));await page.screenshot({path:`.validation/history/cash-${width}.png`})}
 assert.deepEqual(errors,[]);await context.close()
 checks.push('wallet/cash browser pagination reaches final records; four-width layouts and no unexpected browser errors')
 fs.writeFileSync('.validation/history/results.json',JSON.stringify({checks,walletEntries:101,closedShifts:52,liveDataUsed:false},null,2));console.log(`Complete history passed: ${checks.length} acceptance groups.`)
}catch(e){fs.mkdirSync('.validation/history',{recursive:true});fs.writeFileSync('.validation/history/failure.txt',`Phase: ${phase}\n${e?.stack??'unknown'}`);console.error(`History failed at ${phase}: ${e?.message??'unknown'}`);process.exitCode=1}
finally{if(browser)await browser.close();if(ctx)await ctx.close()}

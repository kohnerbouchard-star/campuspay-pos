#!/usr/bin/env node
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {refundTestContext} from './refund-test-context.mjs'
import {runAdministrationLocking} from './administration-locking.mjs'
import {runAdministrationEditorBrowser} from './administration-editor-browser.mjs'
let ctx,phase='setup'
const dir='.validation/administration-hardening'
fs.mkdirSync(dir,{recursive:true})
try{
 ctx=await refundTestContext();await ctx.start(false,{administration:true,cash:true})
 await ctx.owner.query('update private.system_settings set administration_enabled=true,cash_controls_enabled=true where singleton')
 const unchanged=async()=>JSON.stringify((await ctx.owner.query('select (select count(*) from private.students) students,(select count(*) from private.student_cards) cards,(select count(*) from private.student_credentials) pins,(select count(*) from private.wallet_ledger) ledger,(select sum(balance_won) from private.wallets) balances')).rows[0])
 const before=await unchanged(),admin=await ctx.login()
 phase='controlled-lock-overlap'
 const locking=await runAdministrationLocking(ctx,admin)
 fs.writeFileSync(dir+'/locking.json',JSON.stringify({locking,liveDataUsed:false},null,2))
 phase='two-operator-editor'
 const browser=await runAdministrationEditorBrowser(ctx,admin)
 fs.writeFileSync(dir+'/browser.json',JSON.stringify(browser,null,2))
 assert.equal(await unchanged(),before)
 fs.writeFileSync(dir+'/results.json',JSON.stringify({lockingCases:locking.length,negativeControls:locking.filter(x=>x.baseline).length,editorChecks:browser.checks,studentStateUnchanged:true,liveDataUsed:false},null,2))
 console.log(`Administration hardening passed: ${locking.length} controlled lock cases (including a reproduced pre-fix administration deadlock; login races are in audit-login-checks), four two-operator editor checks; synthetic localhost data only.`)
}catch(e){fs.writeFileSync(dir+'/failure.txt',`Phase: ${phase}\n${e.stack??'unknown'}`);console.error(`Administration hardening failed at ${phase}: ${e.message??'unknown'}`);process.exitCode=1}
finally{if(ctx)await ctx.close()}

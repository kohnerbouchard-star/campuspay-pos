// All effects are confined to a fresh localhost database and synthetic actors.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import { refundTestContext } from './refund-test-context.mjs'
import { auditRefundChecks } from './audit-refund-checks.mjs'
import { auditLoginChecks } from './audit-login-checks.mjs'
import { auditUpgradeCheck } from './audit-upgrade-check.mjs'
const dir='.validation/audit-fixes';fs.mkdirSync(dir,{recursive:true})
let ctx,phase='setup'
try {
 const upgrade=await auditUpgradeCheck()
 ctx=await refundTestContext();await ctx.start(true,{cash:true,administration:true,partialRefunds:true})
 await ctx.owner.query('update private.system_settings set refunds_enabled=true,partial_refunds_enabled=true,cash_controls_enabled=true,administration_enabled=true where singleton')
 const admin=await ctx.login(),session=await ctx.request(admin,'/api/auth/session')
 phase='refunds';const refunds=await auditRefundChecks(ctx,admin,session)
 phase='login';const login=await auditLoginChecks(ctx,admin,session)
 assert.ok(refunds.length>8 && login.length>8)
 fs.writeFileSync(dir+'/results.json',JSON.stringify({upgrade,refunds,login,syntheticLocalhostOnly:true},null,2)+'\n')
 console.log(`Audit fixes passed: ${refunds.length} refund checks and ${login.length} login/race checks.`)
} catch(e) {
 fs.writeFileSync(dir+'/failure.txt',`Phase: ${phase}\n${e.stack??'unknown'}`)
 console.error(`Audit fixes failed at ${phase}: ${e.message}`);process.exitCode=1
} finally {await ctx?.close()}

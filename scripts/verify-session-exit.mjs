// Synthetic localhost only. Checks real UI and real session revocation.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import {chromium,expect} from '@playwright/test'
import {refundTestContext} from './refund-test-context.mjs'
let ctx,browser,phase='setup'
const checks=[],errors=[],marker='synthetic-preserved-recovery',key='campuspay:refund:v1'
fs.mkdirSync('.validation/session-exit',{recursive:true})
try{
 ctx=await refundTestContext();await ctx.start(true)
 browser=await chromium.launch({headless:true})
 async function pageFor(cookies){
  const context=await browser.newContext();await context.addCookies([...cookies].filter(([,v])=>v).map(([name,value])=>({name,value,url:ctx.base})))
  const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.setDefaultTimeout(15000);return page
 }
 const cookies=await ctx.login();let page=await pageFor(cookies)
 await page.goto(ctx.base+'/cash');await page.evaluate(([k,v])=>sessionStorage.setItem(k,v),[key,marker])
 const fail=route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({ok:false,error:{code:'INTERNAL_ERROR',message:'Synthetic failed revocation'}})})
 phase='manual-failed-revocation'
 await page.route('**/api/auth/logout',fail,{times:1});await page.getByRole('button',{name:'Sign out',exact:true}).click()
 await expect(page.getByText('Sign out could not be confirmed. Retry before leaving this device unattended.',{exact:true})).toBeVisible()
 assert.equal(new URL(page.url()).pathname,'/cash');await ctx.request(cookies,'/api/auth/session')
 assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),marker)
 checks.push('failed manual revocation stays visible and retryable; no redirect or recovery-storage loss')
 phase='malformed-confirmation'
 await page.route('**/api/auth/logout',route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data:{signedOut:false}})}),{times:1})
 await page.getByRole('button',{name:'Sign out',exact:true}).click()
 await expect(page.getByText('Sign out could not be confirmed. Retry before leaving this device unattended.',{exact:true})).toBeVisible()
 assert.equal(new URL(page.url()).pathname,'/cash');checks.push('malformed successful envelope does not confirm logout')
 phase='committed-response-loss'
 await page.route('**/api/auth/logout',async route=>{const response=await route.fetch();assert.equal(response.status(),200);await fail(route)},{times:1})
 await page.getByRole('button',{name:'Sign out',exact:true}).click()
 await expect(page.getByText('Sign out could not be confirmed. Retry before leaving this device unattended.',{exact:true})).toBeVisible()
 await ctx.request(cookies,'/api/auth/session',undefined,401)
 await page.getByRole('button',{name:'Sign out',exact:true}).click();await page.waitForURL(url=>url.pathname!=='/cash')
 assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),marker)
 checks.push('committed lost response stays unconfirmed; safe retry completes without deleting recovery storage');await page.context().close()
 phase='idle-failed-revocation'
 const idleCookies=await ctx.login();page=await pageFor(idleCookies);await page.clock.install()
 await page.goto(ctx.base+'/cash');await expect(page.getByRole('button',{name:'Sign out',exact:true})).toBeVisible()
 await page.evaluate(([k,v])=>sessionStorage.setItem(k,v),[key,marker])
 await page.route('**/api/auth/logout',fail,{times:1})
 await page.clock.fastForward(15*60*1000+1000)
 await page.waitForURL(url=>url.pathname==='/login'&&url.searchParams.get('logout')==='unconfirmed')
 await expect(page.getByText('This workspace was hidden after inactivity, but sign out could not be confirmed. Retry before leaving this device unattended.',{exact:true})).toBeVisible()
 await expect(page.getByText('Your session ended. Sign in to continue.',{exact:true})).toHaveCount(0)
 await ctx.request(idleCookies,'/api/auth/session')
 assert.equal(await page.evaluate(k=>sessionStorage.getItem(k),key),marker)
 let loginPosts=0;page.on('request',r=>{if(r.method()==='POST'&&new URL(r.url()).pathname==='/api/auth/login')loginPosts++})
 await page.getByRole('button',{name:'Retry sign out',exact:true}).click();await page.waitForURL(url=>url.searchParams.get('logout')!=='unconfirmed')
 await ctx.request(idleCookies,'/api/auth/session',undefined,401);assert.equal(loginPosts,0)
 checks.push('idle failure hides workspace without claiming expiration; explicit retry revokes session and never submits login form')
 assert.deepEqual(errors,[])
 fs.writeFileSync('.validation/session-exit/results.json',JSON.stringify({checks,unexpectedBrowserErrors:errors,liveDataUsed:false},null,2))
 console.log(`Session exit passed: ${checks.length} groups.`)
}catch(error){fs.writeFileSync('.validation/session-exit/failure.json',JSON.stringify({phase,error:error.message,checks},null,2));throw error}
finally{await browser?.close();await ctx?.close()}

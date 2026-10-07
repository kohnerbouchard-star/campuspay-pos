#!/usr/bin/env node
// Render the real-component fixture and retain exact label/role diagnostics.
// Synthetic data and loopback only; no application or financial requests.
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { createServer } from 'node:http'
import { build } from 'vite'
import { chromium, expect } from '@playwright/test'
const out='.validation/ui-fixes';fs.mkdirSync(out,{recursive:true})
const diagnostics={console:[],pageErrors:[],requests:[],responses:[],failedRequests:[]}
let server,browser
try{
 const bundle=await build({configFile:false,envFile:false,logLevel:'error',resolve:{alias:{'@':path.resolve('src')}},define:{'process.env':'{"NODE_ENV":"production"}','process.browser':'true'},oxc:{jsx:{runtime:'automatic'}},build:{write:false,minify:false,lib:{entry:'scripts/ui-fixes-fixture.tsx',formats:['iife'],name:'CampusPayUiFixture'},rolldownOptions:{output:{inlineDynamicImports:true}}}})
 const outputs=(Array.isArray(bundle)?bundle:[bundle]).flatMap(b=>b.output)
 const script=outputs.find(o=>o.type==='chunk'&&o.isEntry)?.code;assert.ok(script)
 const css=fs.readFileSync('src/app/globals.css','utf8')+'\n'+fs.readFileSync('src/app/usability.css','utf8')
 server=createServer((req,res)=>{if(req.url==='/fixture.js'){res.setHeader('Content-Type','text/javascript; charset=utf-8');res.end(script)}else if(req.url==='/fixture.css'){res.setHeader('Content-Type','text/css; charset=utf-8');res.end(css)}else if(req.url?.startsWith('/?')){res.setHeader('Content-Type','text/html; charset=utf-8');res.end('<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/fixture.css"></head><body><div id="root"></div><script src="/fixture.js"></script></body></html>')}else{res.statusCode=404;res.end()}})
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`
 browser=await chromium.launch({headless:true,...(process.env.CHROMIUM_EXECUTABLE_PATH?{executablePath:process.env.CHROMIUM_EXECUTABLE_PATH}:{})})
 const context=await browser.newContext({viewport:{width:1440,height:1000}})
 await context.addInitScript(()=>{Object.defineProperty(globalThis,'process',{value:{env:{NODE_ENV:'production'},browser:true,nextTick:(callback,...args)=>queueMicrotask(()=>callback(...args))},configurable:true})})
 const page=await context.newPage();page.setDefaultTimeout(12000)
 page.on('console',m=>diagnostics.console.push({type:m.type(),text:m.text()}));page.on('pageerror',e=>diagnostics.pageErrors.push(e.message))
 page.on('response',r=>diagnostics.responses.push({path:new URL(r.url()).pathname,status:r.status()}));page.on('requestfailed',r=>diagnostics.failedRequests.push({path:new URL(r.url()).pathname,error:r.failure()?.errorText}))
 await context.route('**/*',async route=>{
  const req=route.request(),url=new URL(req.url());if(url.origin!==base)return route.abort('blockedbyclient')
  if(!url.pathname.startsWith('/api/'))return route.continue()
  diagnostics.requests.push({method:req.method(),path:url.pathname,query:url.search})
  assert.equal(req.method(),'GET','Diagnostic must not mutate anything');assert.equal(url.pathname,'/api/students/roster')
  const data=[{student_id:'00000000-0000-4000-8000-000000000001',student_code:'UI-001',display_name:'Synthetic Student 001',active:true,card_active:true,pin_set:true,balance_won:0,pin_locked_until:null,created_at:'2026-01-01T00:00:00Z',audit_reference:null,year_group:7,academic_year:'2026',total_count:1}]
  await route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({ok:true,data})})
 })
 await page.goto(`${base}/?screen=students`);await page.getByLabel('Search students',{exact:true}).fill('Synthetic')
 await expect(page.getByRole('row').filter({hasText:'UI-001'})).toBeVisible()
 diagnostics.characterSet=await page.evaluate(()=>document.characterSet);assert.equal(diagnostics.characterSet,'UTF-8')
 await expect(page.getByText('MICA Money · E202',{exact:true})).toBeVisible()
 diagnostics.controls=await page.locator('input,select').evaluateAll(nodes=>nodes.map(n=>({tag:n.tagName,outerHTML:n.outerHTML,labels:[...(n.labels??[])].map(l=>({text:l.textContent,html:l.outerHTML})),ariaLabel:n.getAttribute('aria-label'),ariaLabelledBy:n.getAttribute('aria-labelledby')})))
 diagnostics.exactStudentYearLabelCount=await page.getByLabel('Student Year',{exact:true}).count()
 diagnostics.exactStudentYearRoleCount=await page.getByRole('combobox',{name:'Student Year',exact:true}).count()
 await expect(page.getByRole('combobox',{name:'Student Year',exact:true})).toHaveCount(1)
 await expect(page.getByRole('combobox',{name:'Student Year',exact:true})).toHaveAccessibleName('Student Year')
 diagnostics.comboboxAccessibleSnapshot=await page.getByRole('combobox').ariaSnapshot()
 diagnostics.bodyAccessibleSnapshot=await page.locator('body').ariaSnapshot()
 diagnostics.bodyHTML=await page.locator('body').innerHTML()
 await page.screenshot({path:`${out}/label-diagnostic-desktop.png`})
 assert.deepEqual(diagnostics.pageErrors,[])
 assert.ok(diagnostics.responses.some(r=>r.path==='/api/students/roster'&&r.status===200))
 console.log('UI_LABEL_DIAGNOSTICS '+JSON.stringify(diagnostics))
}catch(error){diagnostics.error=String(error);console.error(error);process.exitCode=1}
finally{fs.writeFileSync(`${out}/label-diagnostics.json`,JSON.stringify(diagnostics,null,2));await browser?.close();if(server)await new Promise(r=>server.close(r))}

import test from 'node:test'
import assert from 'node:assert/strict'
import { createHmac } from 'node:crypto'
import { deploymentPolicy, approvedOrigin, mutationOriginAllowed } from '../src/lib/http/deployment-policy.ts'
import { signedIngressIp, customerIngressBucket, trustedClientIp } from '../src/lib/http/trusted-ip.ts'
const prod = { NODE_ENV:'production', VERCEL:'1', STAFF_ORIGIN:'https://pos.school.test', STORE_ORIGIN:'https://store.school.test', COOKIE_SECURE:'true' }
const policy = deploymentPolicy(prod)
const req = (host, path='/api/auth/activity', origin=host, extra={}) => new Request(host+path, { method:'POST', headers:{ ...(origin ? {origin} : {}), ...extra } })
test('production requires two valid HTTPS hostnames and secure cookies', () => {
  for (const patch of [{STAFF_ORIGIN:''},{STORE_ORIGIN:''},{COOKIE_SECURE:'false'},{COOKIE_SECURE:'junk'},
    {STAFF_ORIGIN:'http://pos.school.test'},{STORE_ORIGIN:'http://store.school.test'},
    {STAFF_ORIGIN:'https://store.school.test:444'},{STAFF_ORIGIN:'https://localhost'},
    {STORE_ORIGIN:'https://127.0.0.1'},{STAFF_ORIGIN:'not a url'},
    {STAFF_ORIGIN:'ftp://pos.school.test'},{STAFF_ORIGIN:'https://user:password@pos.school.test'},
    {STAFF_ORIGIN:'https://pos.school.test/path'},{STAFF_ORIGIN:'https://pos.school.test?query'},
    {STAFF_ORIGIN:'https://pos.school.test#fragment'},{DATABASE_URL_UNPOOLED:'must-not-be-in-app'},
    {VERCEL:'0'},{VERCEL:'0',CAMPUSPAY_INGRESS_SECRET:'short'},
    {CAMPUSPAY_LOCAL_HTTP:'true'}]) assert.throws(()=>deploymentPolicy({...prod,...patch}))
  assert.equal(deploymentPolicy({...prod,COOKIE_SECURE:undefined}).mode,'production')
  assert.equal(deploymentPolicy({...prod,VERCEL:'0',CAMPUSPAY_INGRESS_SECRET:'s'.repeat(32)}).mode,'production')
  assert.equal(deploymentPolicy({...prod,NODE_ENV:'development'}).mode,'production')
})
test('unknown/default hosts and sibling origins cannot access production mutations', () => {
  assert.equal(approvedOrigin(req('https://pos.school.test'),policy),prod.STAFF_ORIGIN)
  assert.equal(approvedOrigin(req('https://store.school.test'),policy),prod.STORE_ORIGIN)
  assert.equal(approvedOrigin(req('https://unapproved.vercel.app'),policy),null)
  assert.equal(approvedOrigin(req('https://pos.school.test','/',null,{host:'evil.test'}),policy),null)
  assert.equal(mutationOriginAllowed(req(prod.STAFF_ORIGIN),policy),true)
  assert.equal(mutationOriginAllowed(req(prod.STORE_ORIGIN,'/api/store/login'),policy),true)
  for (const request of [req('https://unapproved.vercel.app'),req(prod.STAFF_ORIGIN,'/api/auth/activity',null),
    req(prod.STAFF_ORIGIN,'/api/auth/activity',prod.STORE_ORIGIN),req(prod.STAFF_ORIGIN,'/api/store/login'),
    req(prod.STORE_ORIGIN,'/api/auth/activity'),req(prod.STAFF_ORIGIN,'/api/auth/activity',prod.STAFF_ORIGIN,{'sec-fetch-site':'cross-site'}),
    req(prod.STAFF_ORIGIN,'/api/auth/activity','null')]) assert.equal(mutationOriginAllowed(request,policy),false)
})
test('local production-build testing is explicit and bound to a loopback origin', () => {
  assert.throws(()=>deploymentPolicy({NODE_ENV:'production'}))
  for(const patch of [{},{APP_ORIGIN:'http://192.168.1.5:3000'},{APP_ORIGIN:'http://localhost:3000',STAFF_ORIGIN:prod.STAFF_ORIGIN}])
    assert.throws(()=>deploymentPolicy({NODE_ENV:'production',CAMPUSPAY_LOCAL_HTTP:'true',...patch}))
  const local=deploymentPolicy({NODE_ENV:'production',CAMPUSPAY_LOCAL_HTTP:'true',APP_ORIGIN:'http://127.0.0.1:3113',COOKIE_SECURE:'false'})
  assert.equal(approvedOrigin(req('http://127.0.0.1:3113'),local),'http://127.0.0.1:3113')
  assert.equal(approvedOrigin(req('http://127.0.0.1:3114'),local),null)
  assert.equal(mutationOriginAllowed(req('http://127.0.0.1:3113','/api/auth/login',null),local),true)
  const dev=deploymentPolicy({NODE_ENV:'development'})
  assert.equal(approvedOrigin(req('http://localhost:3000'),dev),'http://localhost:3000')
  assert.equal(approvedOrigin(req('http://[::1]:3100'),dev),'http://[::1]:3100')
  assert.equal(approvedOrigin(req('http://attacker.test'),dev),null)
  assert.equal(approvedOrigin(req('http://localhost:3000','/',null,{host:'elsewhere.test'}),dev),null)
  assert.equal(mutationOriginAllowed(req('http://localhost:3000','/api/auth/login','http://elsewhere.test'),dev),false)
  assert.equal(deploymentPolicy({APP_ORIGIN:'http://localhost:3000'}).local,'http://localhost:3000')
})
test('self-hosted IP assertions require a fresh method/path-bound signature', () => {
  const secret='q'.repeat(32), stamp='1790820000', now=Number(stamp)*1000, ip='192.0.2.8'
  const signed=(overrides={})=>req(prod.STORE_ORIGIN,'/api/store/login',prod.STORE_ORIGIN,{
    'x-campuspay-client-ip':ip,'x-campuspay-ingress-time':stamp,
    'x-campuspay-ingress-signature':createHmac('sha256',secret).update(`${stamp}\nPOST\n/api/store/login\n${ip}`).digest('hex'),...overrides})
  assert.equal(signedIngressIp(signed(),secret,now),ip)
  for(const request of [signed({'x-campuspay-client-ip':'192.0.2.9'}),signed({'x-campuspay-client-ip':'bad'}),
    signed({'x-campuspay-ingress-time':'0'}),signed({'x-campuspay-ingress-signature':'bad'}),req(prod.STORE_ORIGIN)])
      assert.equal(signedIngressIp(request,secret,now),null)
  assert.equal(signedIngressIp(signed(),secret,now+31000),null)
  assert.equal(signedIngressIp(signed(),secret,now-31000),null)
  assert.equal(signedIngressIp(signed(),'short',now),null)
  assert.equal(signedIngressIp(signed(),undefined,now),null)
  assert.equal(signedIngressIp(signed(),'x'.repeat(32),now),null)
  const moved=new Request(prod.STORE_ORIGIN+'/api/store/orders',{method:'POST',headers:signed().headers})
  assert.equal(signedIngressIp(moved,secret,now),null)
  assert.equal(trustedClientIp(new Headers({'x-forwarded-for':ip}),false),'unverified-ingress')
  assert.equal(customerIngressBucket(req(prod.STORE_ORIGIN),'card-a',{NODE_ENV:'development'}),'customer-local-card:card-a')
  assert.notEqual(customerIngressBucket(req(prod.STORE_ORIGIN),'card-a',{}),customerIngressBucket(req(prod.STORE_ORIGIN),'card-b',{}))
  assert.throws(()=>customerIngressBucket(req(prod.STORE_ORIGIN),'card-a',{NODE_ENV:'production'}))
  assert.equal(customerIngressBucket(req(prod.STORE_ORIGIN,'/api/store/login',prod.STORE_ORIGIN,{'x-vercel-forwarded-for':ip}),'card-a',{NODE_ENV:'production',VERCEL:'1'}),`customer-ip:${ip}`)
})

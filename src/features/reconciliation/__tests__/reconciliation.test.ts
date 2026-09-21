import { describe,it,expect } from 'vitest'
import { ReconciliationSchema,ReconciliationDateSchema,reconciliationCsv } from '../domain'
const empty={business_date:'2026-09-21',timezone:'Asia/Seoul',generated_at:'2026-09-21T03:00:00Z',activity_count:0,status:'NO_POSTED_ACTIVITY',
 metrics:[{section:'Wallet journals',key:'wallet_net',label:'Net change',value:-1000,unit:'KRW',scope:'DAY'}],
 checks:[{code:'WALLET_BALANCES',label:'Wallet balances',checked_count:2,discrepancies:0}]}
describe('daily reconciliation classifications',()=>{
 it('does not label an empty day as certified activity',()=>expect(ReconciliationSchema.parse(empty).status).toBe('NO_POSTED_ACTIVITY'))
 it('requires a discrepancy classification when a check fails',()=>{
  const report={...empty,checks:[{...empty.checks[0],discrepancies:1}]}
  expect(ReconciliationSchema.safeParse(report).success).toBe(false)
  expect(ReconciliationSchema.safeParse({...report,status:'DISCREPANCIES'}).success).toBe(true)
 })
 it('rejects duplicate checks, invalid counts and misleading clear state',()=>{
  for(const change of [{checks:[...empty.checks,...empty.checks]},{metrics:[...empty.metrics,...empty.metrics]},{status:'CHECKS_CLEAR'},{checks:[{...empty.checks[0],discrepancies:3}]}])expect(ReconciliationSchema.safeParse({...empty,...change}).success).toBe(false)
 })
 it('rejects invalid business dates',()=>{for(const date of ['2026-02-30','1999-12-31','2201-01-01','not a date'])expect(ReconciliationDateSchema.safeParse(date).success).toBe(false)})
 it('exports scope, generation timestamp and numeric signs',()=>{const csv=reconciliationCsv(ReconciliationSchema.parse(empty));expect(csv).toContain('"-1000"');expect(csv).toContain('"2026-09-21T03:00:00Z"');expect(csv).toContain('"Current state at report generation"')})
})

import { describe,it,expect } from 'vitest'
import { CashCountsSchema,CashCloseSchema,CashRecoverySchema,denominationTotal } from '../domain'
import { PostReturnSchema,PostRefundSchema } from '@/features/refunds/domain'
import { visibleOrderSteps } from '@/features/store/presentation'
const id='60000000-0000-4000-8000-000000000001'
describe('cash counts and inspected returns',()=>{
 it('counts denominations in won without floating amounts',()=>{
  expect(denominationTotal(CashCountsSchema.parse({'10000':1,'500':1,'100':2}))).toBe(10700)
  expect(CashCountsSchema.safeParse({'10':0}).success).toBe(true)
 })
 it.each([{}, {'100':-1},{'100':0.1},{'100':1000000},{'50000':999999},{'20':3},{'100':'2'},{'0100':2}])('rejects invalid count %#',v=>expect(CashCountsSchema.safeParse(v).success).toBe(false))
 it('requires a real count acknowledgment and close notes',()=>{
  const v={requestKey:id,shiftId:id,counts:{'1000':1},notes:'Actual shift close count',verified:true}
  expect(CashCloseSchema.safeParse(v).success).toBe(true)
  expect(CashCloseSchema.safeParse({...v,verified:false}).success).toBe(false)
  expect(CashCloseSchema.safeParse({...v,notes:'short'}).success).toBe(false)
 })
 it('recovery keeps only operation, shift and request identities',()=>{
  expect(CashRecoverySchema.parse({requestKey:id,operation:'OPEN',shiftId:null})).toEqual({requestKey:id,operation:'OPEN',shiftId:null})
  expect(CashRecoverySchema.safeParse({requestKey:id,operation:'CLOSE',shiftId:null}).success).toBe(false)
  expect(CashRecoverySchema.safeParse({requestKey:id,operation:'OPEN',shiftId:null,counts:{'1000':1}}).success).toBe(false)
 })
 it('does not weaken the original refund request schema',()=>{
  const v={saleId:id,idempotencyKey:id,reasonCode:'CUSTOMER_RETURN',notes:'All returned goods inspected',verified:true,items:[{sale_item_id:id,disposition:'RESTOCK'}],returnReason:'CUSTOMER_RETURN'}
  expect(PostReturnSchema.safeParse(v).success).toBe(true)
  expect(PostRefundSchema.safeParse(v).success).toBe(false)
  expect(PostReturnSchema.safeParse({...v,returnReason:null}).success).toBe(false)
  expect(PostReturnSchema.safeParse({...v,verified:false}).success).toBe(false)
 })
 it('terminal order timelines do not promise another delivery',()=>{
  const events=[{status:'PLACED',created_at:'2026-09-18'},{status:'CANCELLED',created_at:'2026-09-18'}]
  expect(visibleOrderSteps('CANCELLED',events)).toEqual(['PLACED','CANCELLED'])
  expect(visibleOrderSteps('RETURNED',[...events.slice(0,1),{status:'RETURNED',created_at:'2026-09-18'}])).toEqual(['PLACED','RETURNED'])
  expect(visibleOrderSteps('PLACED',events)).toContain('DELIVERED')
 })
})

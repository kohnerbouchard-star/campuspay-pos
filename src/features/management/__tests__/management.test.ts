import { describe, expect, it } from 'vitest'
import { RecordChangeSchema, RecordQuerySchema, RecordRecoverySchema, RecordOutcomeSchema } from '../domain'
import { administrationReview, ROLE_DESCRIPTIONS } from '@/features/administration/review'
import { toApiError } from '@/lib/api/errors'
import type { StaffRecord } from '@/features/administration/domain'
const key='10000000-0000-4000-8000-000000000001', target='10000000-0000-4000-8000-000000000002'
const common={requestKey:key,reason:'Verified catalog change',verified:true}
const existing={targetId:target,expectedUpdatedAt:'2026-10-04T01:00:00.123456+00:00'}
const create={...common,kind:'PRODUCT',action:'CREATE_PRODUCT',sku:'TEST-A',name:'Fixture',category:'QA',sellingPriceWon:1000,reorderLevel:0}
const archive={...common,...existing,kind:'PRODUCT',action:'ARCHIVE_PRODUCT'}
const deactivate={...common,...existing,kind:'STUDENT',action:'DEACTIVATE_STUDENT',adminPin:'12345678'}
describe('Narrow record lifecycle contracts',()=>{
 it.each([create,archive,{...archive,action:'RESTORE_PRODUCT'},{...archive,action:'UPDATE_PRODUCT',name:'Edited',category:'QA',reorderLevel:5},{...archive,action:'CHANGE_PRODUCT_PRICE',sellingPriceWon:1200},deactivate,{...deactivate,action:'REACTIVATE_STUDENT'}])('accepts the intended action $action',value=>expect(RecordChangeSchema.safeParse(value).success).toBe(true))
 it.each([{...create,sku:''},{...create,sellingPriceWon:-1},{...create,sellingPriceWon:1.5},{...create,reorderLevel:Infinity},{...create,name:'A\nB'},{...archive,verified:false},{...archive,reason:'short'},{...archive,expectedUpdatedAt:'bad'},{...archive,role:'super_admin'},{...archive,active:true},{...archive,stock:0},{...deactivate,adminPin:''},{...deactivate,balanceWon:0},{...deactivate,kind:'PRODUCT'},{...archive,action:'DELETE_PRODUCT'},{...deactivate,action:'DELETE_STUDENT'}])('rejects forged, destructive or malformed action %#',value=>expect(RecordChangeSchema.safeParse(value).success).toBe(false))
 it('preserves the full optimistic version; does not truncate it through a Date',()=>expect(RecordChangeSchema.parse(archive)).toMatchObject(existing))
 it('recovery contains only kind and opaque request ID',()=>{
  expect(RecordRecoverySchema.parse({kind:'PRODUCT',requestKey:key})).toEqual({kind:'PRODUCT',requestKey:key})
  for(const extra of [{adminPin:'1234'},{studentId:target},{payload:{}},{reason:'do not store'}])expect(RecordRecoverySchema.safeParse({kind:'STUDENT',requestKey:key,...extra}).success).toBe(false)
 })
 it('requires a complete mutation receipt',()=>{
  expect(RecordOutcomeSchema.safeParse({outcome:'COMPLETED'}).success).toBe(false)
  expect(RecordOutcomeSchema.safeParse({outcome:'COMPLETED',target_id:target,audit_reference:''}).success).toBe(false)
  expect(RecordOutcomeSchema.safeParse({outcome:'COMPLETED',target_id:target,audit_reference:'AUD-X'}).success).toBe(true)
 })
 it.each([{kind:'STAFF'},{kind:'PRODUCT',offset:-1},{kind:'STUDENT',targetId:'bad'},{kind:'PRODUCT',offset:1.5},{kind:'PRODUCT',query:'a'.repeat(121)},{kind:'PRODUCT',status:'DELETED'}])('rejects invalid directory options %#',query=>expect(RecordQuerySchema.safeParse(query).success).toBe(false))
 it.each(['RECORD_STALE','RECORD_HAS_STOCK','RECORD_HAS_BALANCE','RECORD_HAS_ORDERS','RECORD_CODE_EXISTS'])('explains %s without raw database detail',code=>{
  const result=toApiError(new Error(`${code}: secret SQL detail`));expect(result.status).toBe(409);expect(result.message).not.toContain('secret')
 })
})
describe('Staff role review language',()=>{
 const previous:StaffRecord={user_id:target,employee_code:'QA-1',display_name:'Named operator',role:'cashier',active:true,updated_at:existing.expectedUpdatedAt,has_pin:true}
 const change={action:'UPDATE_STAFF' as const,requestKey:key,adminPin:'12345678',targetId:target,displayName:previous.display_name,role:previous.role,active:false,expectedUpdatedAt:previous.updated_at,notes:'Identity and access verified',verified:true as const}
 it('names the affected account, preserves its identity and warns about sign-out',()=>{
  const review=administrationReview(change,previous);expect(review.destructive).toBe(true);expect(review.token).toBe('QA-1');expect(review.description).toContain('sessions will end');expect(review.description).toContain('transaction history remain');expect(JSON.stringify(review)).not.toContain(change.adminPin)
 })
 it('marks a role change as sensitive even while the account remains active',()=>expect(administrationReview({...change,active:true,role:'super_admin'},previous).destructive).toBe(true))
 it('separates staff and student identities at creation',()=>expect(administrationReview({action:'CREATE_STAFF',requestKey:key,adminPin:'12345678',employeeCode:'NEW-STAFF',displayName:'New person',role:'accountant',newPin:'1234',confirmationPin:'1234',notes:'New staff verified',verified:true}).description).toContain('not a student wallet'))
 it('covers all four real application roles without adding a new privilege',()=>expect(Object.keys(ROLE_DESCRIPTIONS).sort()).toEqual(['accountant','cashier','inventory_admin','super_admin']))
})

import { describe,it,expect } from 'vitest'
import { AdministrationChangeSchema,AdministrationRecoverySchema } from '../domain'
import { toApiError } from '@/lib/api/errors'
const id='70000000-0000-4000-8000-000000000001'
const v={requestKey:id,action:'CREATE_STAFF',employeeCode:'NAMED-12',displayName:'Named staff member',role:'cashier',preset:'staff',newPin:'01729046',confirmationPin:'01729046',adminPin:'98765432',notes:'Identity and authorized role checked',verified:true}
describe('deliberate administrative actions',()=>{
 it('accepts a fully verified named account without altering PIN leading zeros',()=>expect(AdministrationChangeSchema.parse(v)).toEqual(v))
 it.each([{verified:false},{confirmationPin:'12345678'},{adminPin:'123'},{newPin:'1234x',confirmationPin:'1234x'},{employeeCode:' spaces '},{employeeCode:'a'},{role:'owner'},{notes:'short'},{notes:'a long note\nwith control'},{displayName:''},{targetId:id},{balance:20000}])('rejects incomplete, unsafe or unexpected input %#',x=>expect(AdministrationChangeSchema.safeParse({...v,...x}).success).toBe(false))
 it('requires an optimistic version for staff profile edits',()=>{
  const edit={action:'UPDATE_STAFF',targetId:id,requestKey:id,displayName:'Checked name',role:'accountant',active:true,expectedUpdatedAt:'2026-09-18T07:00:00.123456+00:00',adminPin:'12345678',notes:'Role approved by the school owner',verified:true}
  expect(AdministrationChangeSchema.safeParse(edit).success).toBe(true)
  expect(AdministrationChangeSchema.safeParse({...edit,expectedUpdatedAt:undefined}).success).toBe(false)
  expect(AdministrationChangeSchema.safeParse({...edit,active:'false'}).success).toBe(false)
 })
 it('browser recovery accepts only one opaque identity',()=>{
  expect(AdministrationRecoverySchema.parse({requestKey:id})).toEqual({requestKey:id})
  for(const extra of [{adminPin:'12345678'},{newPin:'12345678'},{action:'CREATE_STAFF'},{employeeCode:'1234'}])expect(AdministrationRecoverySchema.safeParse({requestKey:id,...extra}).success).toBe(false)
 })
 it.each([['ADMINISTRATION_DISABLED',409],['OPEN_CASH_SHIFT',409],['LAST_ADMIN_REQUIRED',409],['SELF_CHANGE_FORBIDDEN',403]])('maps %s to a safe rejection', (code,status)=>expect(toApiError(new Error(String(code))).status).toBe(status))
})

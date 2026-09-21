import { describe,it,expect } from 'vitest'
import { randomInt } from 'node:crypto'
import { PrepareFundingSchema,FundingKeySchema,ConfirmFundingSchema,type FundingReceipt } from '../domain'
import { fundingCsv } from '../csv'
import { CashShiftSchema } from '@/features/cash/domain'
const key='81000000-0000-4000-8000-000000000001'
const deposit={requestKey:key,action:'CASH_DEPOSIT',denominations:[10000],cashReceivedWon:20000,sourceReference:'Verified receipt',notes:'Actual synthetic cash received'}
describe('controlled funds and cash inputs',()=>{
 it('retains approved denominations and treats received cash separately',()=>expect(PrepareFundingSchema.parse(deposit)).toEqual(deposit))
 it.each([{cashReceivedWon:9999},{denominations:[0]},{denominations:[100]},{denominations:Array(31).fill(1000)},{amountWon:10000},{notes:'short'},{sourceReference:'bad\nreference'}])('rejects unsafe input %#',v=>expect(PrepareFundingSchema.safeParse({...deposit,...v}).success).toBe(false))
 it('requires a real nonzero denomination count for manual cash',()=>{
  const v={requestKey:key,action:'CASH_DROP',counts:{'1000':1},sourceReference:'Safe receipt',notes:'Verified drop into the safe'}
  expect(PrepareFundingSchema.safeParse(v).success).toBe(true)
  expect(PrepareFundingSchema.safeParse({...v,counts:{'1000':0}}).success).toBe(false)
 })
 it('recovery stores only the opaque request key',()=>{
  expect(FundingKeySchema.parse({requestKey:key})).toEqual({requestKey:key})
  expect(FundingKeySchema.safeParse({requestKey:key,studentPin:String(randomInt(1000,10000))}).success).toBe(false)
  expect(ConfirmFundingSchema.safeParse({requestKey:key,verified:false}).success).toBe(false)
  expect(ConfirmFundingSchema.safeParse({requestKey:key,verified:true,approverCode:'9001'}).success).toBe(false)
 })
 it('cash close equation includes funding and manual movements',()=>{
  const v={shift_id:key,terminal_id:key,terminal_label:null,opened_by:key,opened_at:'2026-09-21',closed_at:null,opening_float_won:50000,cash_sales_won:1000,cash_payouts_won:500,funding_in_won:10000,funding_out_won:2000,expected_won:58500,counted_won:null,variance_won:null,close_notes:null,closed_by:null,approved_by:null,approval_notes:null,review_required:false}
  expect(CashShiftSchema.safeParse(v).success).toBe(true)
  expect(CashShiftSchema.safeParse({...v,expected_won:50500}).success).toBe(false)
 })
 it('CSV quotes source text and neutralizes formula prefixes without changing numeric signs',()=>{
  const row={reference_number:'FND-TEST',created_at:'2026-09-21',action:'ADMIN_DEBIT',student_code:'S1',student_name:'=1+1',wallet_delta_won:-1000,cash_delta_won:0,cash_received_won:0,change_won:0,balance_before_won:0,balance_after_won:-1000,shift_id:null,terminal_label:'Terminal',actor_name:'Staff',approver_name:'Approver',source_reference:'@SUM(1)',notes:'A "quoted" note',original_reference:null,reversed_by_reference:null} as FundingReceipt
  const text=fundingCsv([row]);expect(text).toContain('"\'=1+1"');expect(text).toContain('"\'@SUM(1)"');expect(text).toContain('"-1000"');expect(text).toContain('A ""quoted"" note')
 })
})

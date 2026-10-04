'use client'
import { useEffect,useRef,useState } from 'react'
import { apiFetch,ClientApiError } from '@/lib/api/client'
import { RemovalRecoverySchema,RemovalResultSchema,type RemovalChange,type RemovalResult } from './domain'
import type { z } from 'zod'
type Pending=z.infer<typeof RemovalRecoverySchema>
export function useRemovalOperation(userId:string,onSaved:(result:RemovalResult)=>void|Promise<void>){
 const storageKey=`campuspay:removal-operation:${userId}:v1`,lock=useRef(false)
 const [ready,setReady]=useState(false),[blocked,setBlocked]=useState(false),[pending,setPending]=useState<Pending|null>(null)
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
 useEffect(()=>{let active=true;void Promise.resolve().then(()=>{try{const raw=sessionStorage.getItem(storageKey),saved=raw?RemovalRecoverySchema.parse(JSON.parse(raw)):null;if(active){setPending(saved);setReady(true)}}catch{if(active){setBlocked(true);setError('Recovery storage cannot be read. Check the existing deletion audit before repeating an uncertain action.')}}});return()=>{active=false}},[storageKey])
 function clear(){sessionStorage.removeItem(storageKey);if(sessionStorage.getItem(storageKey)!==null)throw new Error('Recovery marker remains');setPending(null)}
 async function perform(input:RemovalChange|null){
  if(lock.current||!ready||blocked||(input&&pending)||(!input&&!pending))return false
  lock.current=true;setBusy(true);setError('');setMessage('');let submitted=false
  try{
   const saved=input?{kind:input.kind,requestKey:input.requestKey}:pending!
   if(input){const previous=sessionStorage.getItem(storageKey);if(previous){setPending(RemovalRecoverySchema.parse(JSON.parse(previous)));setError('Recover the previous deletion or restoration first.');return false}const serialized=JSON.stringify(saved);sessionStorage.setItem(storageKey,serialized);if(sessionStorage.getItem(storageKey)!==serialized)throw new Error('Storage unavailable');setPending(saved)}
   submitted=true
   const result=RemovalResultSchema.parse(await apiFetch<unknown>(input?'/api/removals':'/api/removals/recover',{method:'POST',body:JSON.stringify(input??saved)}))
   if(result.outcome==='AUTH_FAILED')throw new Error('Unexpected authorization result')
   setMessage(result.outcome==='COMPLETED'?`${result.deleted?'Record deleted. Restore it from Deleted records in Staff & registers.':'Record restored.'} Reference: ${result.audit_reference}`:'Request closed without a change. A delayed request cannot apply it now.')
   try{clear()}catch{setBlocked(true);setError('The result is confirmed but recovery storage could not be cleared. Do not submit another change in this browser.')}
   try{await onSaved(result)}catch{setError('The result is confirmed. The directory refresh failed; refresh it before another change.')}
   return result.outcome==='COMPLETED'
  }catch(cause){
   if(input&&submitted&&cause instanceof ClientApiError&&cause.status<500){try{clear();setError(cause.message)}catch{setBlocked(true);setError('The rejected request recovery marker could not be cleared.')}}
   else if(!submitted){setBlocked(true);setError('Nothing was sent because its recovery reference could not be saved safely.')}
   else setError(cause instanceof ClientApiError&&cause.status<500?cause.message:'Result unknown. Recover the saved action before submitting another; keep browser storage intact.')
   return false
  }finally{lock.current=false;setBusy(false)}
 }
 return {ready,blocked,pending,busy,error,message,execute:(input:RemovalChange)=>perform(input),recover:()=>perform(null)}
}

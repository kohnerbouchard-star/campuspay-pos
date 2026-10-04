'use client'
import { useEffect, useRef, useState } from 'react'
import { apiFetch, ClientApiError } from '@/lib/api/client'
import { RecordOutcomeSchema, RecordRecoverySchema, type RecordChange, type RecordKind } from './domain'

export function useRecordOperation(kind:RecordKind,userId:string,onSaved:()=>void) {
  const storageKey=`campuspay:record-operation:${userId}:${kind}:v1`
  const lock=useRef(false)
  const [ready,setReady]=useState(false),[blocked,setBlocked]=useState(false),[pending,setPending]=useState<string|null>(null)
  const [busy,setBusy]=useState(false),[error,setError]=useState(''),[message,setMessage]=useState('')
  useEffect(()=>{
    let active=true
    void Promise.resolve().then(()=>{
      try { const raw=sessionStorage.getItem(storageKey)
        const saved=raw?RecordRecoverySchema.parse(JSON.parse(raw)):null
        if(saved&&saved.kind!==kind)throw new Error('Invalid recovery scope')
        if(active){setPending(saved?.requestKey??null);setReady(true)}
      }catch{if(active){setBlocked(true);setError('Recovery storage cannot be read. Do not repeat an uncertain action; ask a Super Admin to check its audit record.')}}
    })
    return()=>{active=false}
  },[kind,storageKey])
  function clear() {
    sessionStorage.removeItem(storageKey)
    if(sessionStorage.getItem(storageKey)!==null)throw new Error('Recovery marker remains')
    setPending(null)
  }
  async function perform(input:RecordChange|null) {
    if(lock.current||!ready||blocked||(input&&pending)||(!input&&!pending))return false
    lock.current=true;setBusy(true);setError('');setMessage('')
    let submitted=false
    try {
      const key=input?.requestKey??pending!
      if(input){
        // Recheck storage at submission, not just mount: another mounted editor
        // must not replace the original operation on this account/surface.
        const previous=sessionStorage.getItem(storageKey)
        if(previous){const saved=RecordRecoverySchema.parse(JSON.parse(previous));setPending(saved.requestKey);setError('Recover the previous action before starting another.');return false}
        sessionStorage.setItem(storageKey,JSON.stringify({kind,requestKey:key}))
        if(sessionStorage.getItem(storageKey)!==JSON.stringify({kind,requestKey:key}))throw new Error('Storage unavailable')
        setPending(key)
      }
      submitted=true
      const data=RecordOutcomeSchema.parse(await apiFetch<unknown>(input?'/api/management':'/api/management/recover',{
        method:'POST',body:JSON.stringify(input??{kind,requestKey:key}),
      }))
      if(data.outcome==='AUTH_FAILED')throw new Error('Unexpected authorization result')
      // The outcome is authoritative even if local cleanup or list refresh fails.
      setMessage(data.outcome==='COMPLETED'?`Change recorded. Reference: ${data.audit_reference}`:'Request closed without a change. A delayed submission cannot apply it now.')
      try{clear()}catch{setBlocked(true);setError('The result is confirmed but recovery storage could not be cleared. Do not submit another action in this browser.')}
      try{onSaved()}catch{setError('The change is confirmed. Refresh the directory before another action.')}
      return data.outcome==='COMPLETED'
    }catch(cause){
      if(input&&submitted&&cause instanceof ClientApiError&&cause.status<500){
        try{clear();setError(cause.message)}catch{setBlocked(true);setError('The request was rejected but its recovery record could not be cleared.')}
      }else if(!submitted){setBlocked(true);setError('The action was not sent because its recovery reference could not be stored safely.')}
      else setError(cause instanceof ClientApiError&&cause.status<500?cause.message:'Result unknown. Recover the saved action before submitting another; do not clear browser storage.')
      return false
    }finally{lock.current=false;setBusy(false)}
  }
  return {kind,ready,blocked,pending,busy,error,message,execute:(input:RecordChange)=>perform(input),recover:()=>perform(null)}
}

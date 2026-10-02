'use client'
import { useEffect, useRef, useState } from 'react'
import type { SessionContext } from '@/features/auth/domain'
import { postReceipt, recoverReceipt, type ReceiptInput } from '../client'
import { ReceiveStockSchema } from '../domain'
import { apiFetch, ClientApiError } from '@/lib/api/client'
import { validationFeedback } from '@/lib/api/validation'
import { confirmedStockReceipt, forgetConfirmedReceipt, persistReceipt, receiptRecoveryIssue, receiptStorageKey, savedReceiptReference, type ReceiptRecoveryIssue } from '../receipt-recovery'
type Saved = { reference: string; input: ReceiptInput | null }
export function useReceiptRecovery(onSaved: () => void) {
  const [userId, setUserId] = useState<string | null>(null), [saved, setSaved] = useState<Saved | null>(null)
  const [ready, setReady] = useState(false), [busy, setBusy] = useState(false), [revision, setRevision] = useState(0)
  const [issue, setIssue] = useState<ReceiptRecoveryIssue | null>(null), [message, setMessage] = useState<string | null>(null)
  const [missing, setMissing] = useState(false), [confirmed, setConfirmed] = useState<string | null>(null)
  const running = useRef(false)
  useEffect(() => {
    let active = true
    apiFetch<SessionContext>('/api/auth/session').then(session => {
      if (!active) return
      setUserId(session.user_id)
      const raw = sessionStorage.getItem(receiptStorageKey(session.user_id))
      if (raw !== null) {
        const value: unknown = JSON.parse(raw), reference = savedReceiptReference(value)
        if (!reference) throw new Error('Invalid saved reference')
        const parsed = ReceiveStockSchema.safeParse(value)
        setSaved({ reference, input: parsed.success ? parsed.data : null })
      } else setSaved(null)
      setReady(true); setIssue(null)
    }).catch(error => {
      if (!active) return
      setReady(false)
      setIssue(error instanceof ClientApiError ? receiptRecoveryIssue(error) : { message: 'The saved receipt could not be loaded safely. Keep this browser open and ask a Super Admin to inspect it. Do not clear site data.', needsSignIn: false })
    })
    return () => { active = false }
  }, [revision])
  function report(error: unknown) { setIssue(receiptRecoveryIssue(error instanceof ClientApiError ? error : null)) }
  function finish(value: unknown, operation: Saved) {
    if (!confirmedStockReceipt(value)) throw new Error('Receipt confirmation is incomplete')
    setConfirmed(value.receipt_number)
    try { forgetConfirmedReceipt(sessionStorage, userId!, operation.reference) }
    catch { setIssue({ message: `Receipt ${value.receipt_number} is posted, but this browser could not clear its saved reference. Do not submit it again. Restore browser storage and check again.`, needsSignIn: false }); return }
    setSaved(null); setMissing(false); setConfirmed(null); setIssue(null)
    setMessage(`Receipt ${value.receipt_number} posted. Stock and purchase costs have been recorded.`)
    onSaved()
  }
  async function check() {
    if (!saved || !userId || !ready || running.current) return
    running.current = true; setBusy(true); setIssue(null); setMessage(null); setMissing(false)
    try {
      const result = await recoverReceipt(saved.reference)
      // Missing is not cancellation: an earlier request can still be in flight.
      if (result && result.receipt === null) {
        setMissing(true)
        setMessage('No posted receipt was found for this reference yet. The original request may still be in progress. Check again, or deliberately retry the original saved request; do not enter a new receipt.')
      } else finish(result?.receipt, saved)
    } catch (error) { report(error) }
    finally { running.current = false; setBusy(false) }
  }
  async function send(input: ReceiptInput, replay = false) {
    if (!userId || !ready || running.current || (saved && !replay) || (replay && (!saved?.input || !missing))) return
    const reference = replay ? saved!.reference : crypto.randomUUID()
    const parsed = ReceiveStockSchema.safeParse({ ...input, idempotencyKey: reference })
    if (!parsed.success) { setIssue({ message: `${validationFeedback(ReceiveStockSchema, parsed.error.issues).message} Nothing was submitted by this attempt.`, needsSignIn: false }); return }
    const operation: Saved = { reference, input: parsed.data }
    running.current = true; setBusy(true); setIssue(null); setMessage(null); setMissing(false)
    if (!replay) {
      try { persistReceipt(sessionStorage, userId, JSON.stringify(parsed.data)) }
      catch { setReady(false); setIssue({ message: 'The browser could not safely save this request. Nothing was submitted by this attempt. Reload the workspace to check any saved receipt; do not clear site data.', needsSignIn: false }); running.current = false; setBusy(false); return }
      setSaved(operation)
    }
    let accepted = false
    try {
      const result = await postReceipt(operation.input!, reference)
      accepted = true
      finish(result, operation)
    } catch (error) {
      if (replay && error instanceof ClientApiError && error.status === 409) {
        try { const result = await recoverReceipt(reference); if (result?.receipt) { finish(result.receipt, operation); return } }
        catch (recoveryError) { report(recoveryError); return }
      }
      // Only a first, authoritative rejection may discard a newly saved request.
      if (!accepted && !replay && error instanceof ClientApiError && error.status < 500) {
        try { forgetConfirmedReceipt(sessionStorage, userId, reference); setSaved(null) }
        catch { setReady(false) }
        const detail = receiptRecoveryIssue(error)
        setIssue({ ...detail, message: `${error.message}. No stock was posted by this attempt.${detail.needsSignIn ? ' Sign in again with the same employee account.' : ''}` })
      } else report(error)
    } finally { running.current = false; setBusy(false) }
  }
  return { saved, ready, busy, issue, message, missing, confirmed, check, send,
    retry: () => saved?.input ? send(saved.input, true) : Promise.resolve(),
    reload: () => { if (!running.current) { setReady(false); setRevision(n => n + 1) } },
  }
}

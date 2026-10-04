'use client'
import type { useRecordOperation } from './use-record-operation'
export function OperationFeedback({operation}:{operation:ReturnType<typeof useRecordOperation>}) {
  return <>
    {operation.message&&<p className="success-message" role="status">{operation.message}</p>}
    {operation.error&&<p className="error-message" role="alert">{operation.error}</p>}
    {operation.pending&&<section className="uncertain-result" aria-label="Saved management action">
      <h3>Confirm the previous action first</h3><p>Use the same staff account and register. Recovery reads the result or safely closes an unposted request; it does not repeat the change.</p>
      <p className="recovery-reference">Reference: {operation.pending}</p>
      <button type="button" className="secondary-action" disabled={operation.busy||operation.blocked} onClick={()=>void operation.recover()}>Recover management action</button>
      <a className="text-action" href={`/login?expired=1&next=${operation.kind==='PRODUCT'?'%2Finventory':'%2Fstudents'}`}>Sign in again</a>
    </section>}
  </>
}

'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { fetchCoupons } from '@/features/coupons/client'
import type { CouponSummary } from '@/features/coupons/domain'
import { CouponForm } from '@/features/coupons/ui/CouponForm'
import { CouponTable } from '@/features/coupons/ui/CouponTable'

export function CouponManagementScreen({canManage}:{canManage:boolean}) {
  const [coupons, setCoupons] = useState<CouponSummary[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [confirmation, setConfirmation] = useState<{ message: string } | null>(null)
  const confirmationRef = useRef<HTMLParagraphElement>(null)
  const generation = useRef(0)
  useEffect(() => { if (confirmation) confirmationRef.current?.focus() }, [confirmation])

  const load = useCallback(async (focusConfirmation = false) => {
    const current = ++generation.current
    setLoading(true)
    try { const rows = await fetchCoupons(); if (current === generation.current) { setCoupons(rows); setError(null); if (focusConfirmation) confirmationRef.current?.focus() } }
    catch (caught) { if (current === generation.current) setError(caught instanceof Error ? caught.message : 'Coupons could not be loaded') }
    finally { if (current === generation.current) setLoading(false) }
  }, [])

  const invalidateLoad = useCallback(() => { generation.current++ }, [])
  useEffect(() => {
    let active = true
    void Promise.resolve().then(() => { if (active) void load() })
    return () => { active = false; invalidateLoad() }
  }, [load, invalidateLoad])

  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">Store promotions</p><h1>Coupons</h1></div>
      <span className="status-pill">Codes hidden after creation</span>
    </header>
    {confirmation && <p ref={confirmationRef} tabIndex={-1} className="success-message" role="status">{confirmation.message}</p>}
    {error && <div className="error-message" role="alert"><p>{error}</p><button className="secondary-action" disabled={loading} onClick={() => void load(true)}>Retry coupon directory</button></div>}
    <div className="form-stack">
      {canManage && <details className="panel"><summary>Create a coupon</summary><CouponForm onSaved={() => { setConfirmation(null); void load() }} /></details>}
      {loading ? <p role="status">Loading coupon directory…</p> : !error && <CouponTable canManage={canManage} coupons={coupons} onChanged={message => { setConfirmation({ message }); void load() }} />}
      <details className="panel coupon-policy-panel"><summary>Coupon rules and lifecycle</summary>
        <p>One coupon can be used per sale. Its discount applies to the full sale before payment is divided between MICA Money and cash.</p>
        <p>Coupons with a per-student use limit require MICA Money. Cash-only purchases can use coupons without a per-student limit.</p>
        <p>Coupon terms cannot be edited after use. Deactivate the old coupon and issue a new code instead.</p>
        <p>Deactivation stops future redemption. It does not delete the coupon or erase prior discounts.</p>
      </details>
    </div>
  </main>
}

'use client'
import { BUSINESS_TIMEZONE } from '@/lib/format/business-time'
import { useState } from 'react'
import type { CouponSummary } from '@/features/coupons/domain'
import { disableCoupon } from '@/features/coupons/client'
import { formatWon } from '@/lib/format/currency'
import { Dialog } from '@/components/ui/Dialog'
import { EmptyState } from '@/components/ui/Feedback'
function describeDiscount(coupon: CouponSummary): string {
  return coupon.discount_type === 'FIXED' ? formatWon(coupon.fixed_amount_won ?? 0) : `${((coupon.percentage_bps ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}%`
}
export function CouponTable({ coupons, canManage, onChanged }: { coupons: CouponSummary[]; canManage:boolean; onChanged(): void }) {
  const [selected, setSelected] = useState<CouponSummary | null>(null)
  const [busy, setBusy] = useState(false)
  const [reason, setReason] = useState('')
  const [message, setMessage] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  async function deactivate(event: React.FormEvent) {
    event.preventDefault()
    if (!selected || busy) return
    setBusy(true); setError(null)
    try { await disableCoupon(selected.coupon_id, reason); setMessage(`${selected.name} was deactivated.`); setSelected(null); onChanged() }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'Coupon could not be deactivated.') }
    finally { setBusy(false) }
  }
  return <section className="panel table-panel"><div className="panel-heading"><div><p className="eyebrow">Promotion history</p><h2>Coupon register</h2></div></div>{message && <p className="success-message" role="status">{message}</p>}
    {coupons.length === 0 ? <EmptyState title="No coupons yet">{canManage ? 'Create a coupon to offer a discount in the store or at the register.' : 'Coupons will appear here when promotions are created.'}</EmptyState> : <div className="table-scroll" role="region" tabIndex={0} aria-label="Coupon register"><table><thead><tr><th>Coupon</th><th className="numeric">Discount</th><th className="numeric">Minimum</th><th>Usage</th><th className="numeric">Savings issued</th><th>Validity</th><th>Status</th><th><span className="sr-only">Actions</span></th></tr></thead><tbody>{coupons.map(coupon => <tr key={coupon.coupon_id}><td><strong>{coupon.name}</strong><small>{coupon.code_masked}</small></td><td className="numeric">{describeDiscount(coupon)}{coupon.max_discount_won !== null && <small>Max {formatWon(coupon.max_discount_won)}</small>}</td><td className="numeric">{formatWon(coupon.minimum_subtotal_won)}</td><td>{coupon.redemption_count}{coupon.total_redemption_limit !== null ? ` / ${coupon.total_redemption_limit}` : ''}<small>{coupon.per_student_limit === null ? 'No student limit' : `${coupon.per_student_limit} per student`}</small></td><td className="numeric">{formatWon(coupon.discount_given_won)}</td><td><small>{new Date(coupon.starts_at).toLocaleString('en-GB', { timeZone: BUSINESS_TIMEZONE })}</small><small>{coupon.ends_at ? new Date(coupon.ends_at).toLocaleString('en-GB', { timeZone: BUSINESS_TIMEZONE }) : 'No end date'}</small></td><td><span className="status-pill">{coupon.active ? 'Active' : 'Inactive'}</span></td><td>{canManage && coupon.active && <button className="table-action" onClick={() => { setSelected(coupon); setReason(''); setError(null) }}>Deactivate</button>}</td></tr>)}</tbody></table></div>}
    {selected && <Dialog title={`Deactivate ${selected.name}?`} busy={busy} onClose={() => setSelected(null)}><form onSubmit={deactivate}><p>Future purchases will no longer accept this coupon. Previous sales and discounts stay recorded.</p><label className="field"><span>Reason for deactivation</span><input autoFocus required minLength={3} maxLength={240} value={reason} disabled={busy} onChange={e => setReason(e.target.value)} /></label>{error && <p className="error-message" role="alert">{error}</p>}<div className="action-row end"><button className="secondary-action" disabled={busy} type="button" onClick={() => setSelected(null)}>Keep coupon</button><button className="primary-action danger-action" disabled={busy || reason.trim().length < 3}>{busy ? 'Deactivating…' : 'Deactivate coupon'}</button></div></form></Dialog>}
  </section>
}

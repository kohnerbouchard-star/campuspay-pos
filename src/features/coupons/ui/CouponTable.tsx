'use client'

import { useState } from 'react'
import type { CouponSummary } from '@/features/coupons/domain'
import { disableCoupon } from '@/features/coupons/client'
import { formatWon } from '@/lib/format/currency'

function describeDiscount(coupon: CouponSummary): string {
  if (coupon.discount_type === 'FIXED') return formatWon(coupon.fixed_amount_won ?? 0)
  return `${((coupon.percentage_bps ?? 0) / 100).toFixed(2).replace(/\.00$/, '')}%`
}

export function CouponTable({ coupons, onChanged }: { coupons: CouponSummary[]; onChanged(): void }) {
  const [busyId, setBusyId] = useState<string | null>(null)
  const [message, setMessage] = useState<string | null>(null)

  async function deactivate(coupon: CouponSummary) {
    const reason = window.prompt(`Reason for deactivating ${coupon.name}:`, 'Promotion ended')
    if (!reason || reason.trim().length < 3) return
    setBusyId(coupon.coupon_id)
    setMessage(null)
    try {
      await disableCoupon(coupon.coupon_id, reason)
      setMessage(`${coupon.name} was deactivated and logged.`)
      onChanged()
    } catch (caught) {
      setMessage(caught instanceof Error ? caught.message : 'Coupon could not be deactivated')
    } finally {
      setBusyId(null)
    }
  }

  return <section className="panel table-panel">
    <div className="panel-heading"><div><p className="eyebrow">Masked codes and immutable terms</p><h2>Coupon register</h2></div></div>
    {message && <p className="form-message" role="status">{message}</p>}
    <div className="table-scroll"><table><thead><tr><th>Coupon</th><th>Discount</th><th>Minimum</th><th>Usage</th><th>Savings issued</th><th>Window</th><th>Status</th><th /></tr></thead>
      <tbody>{coupons.map((coupon) => <tr key={coupon.coupon_id}>
        <td><strong>{coupon.name}</strong><small>{coupon.code_masked}</small></td>
        <td>{describeDiscount(coupon)}{coupon.max_discount_won !== null && <small>Max {formatWon(coupon.max_discount_won)}</small>}</td>
        <td>{formatWon(coupon.minimum_subtotal_won)}</td>
        <td>{coupon.redemption_count}{coupon.total_redemption_limit !== null ? ` / ${coupon.total_redemption_limit}` : ''}<small>{coupon.per_student_limit === null ? 'No student limit' : `${coupon.per_student_limit} per student`}</small></td>
        <td>{formatWon(coupon.discount_given_won)}</td>
        <td><small>{new Date(coupon.starts_at).toLocaleString()}</small><small>{coupon.ends_at ? new Date(coupon.ends_at).toLocaleString() : 'No end date'}</small></td>
        <td>{coupon.active ? 'Active' : 'Inactive'}</td>
        <td>{coupon.active && <button className="table-action" disabled={busyId === coupon.coupon_id} onClick={() => void deactivate(coupon)}>Deactivate</button>}</td>
      </tr>)}</tbody>
    </table></div>
  </section>
}

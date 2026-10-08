'use client'

import { useId, useState } from 'react'
import { Icon } from '@/components/ui/Icon'
import { boundedQuantity, quantityLimit } from '@/features/pos/quantity'
import styles from './CartQuantity.module.css'

export function CartQuantity({ name, quantity, stock, onChange }: {
  name: string; quantity: number; stock: number; onChange(quantity: number): void
}) {
  const id = useId()
  const limit = quantityLimit(stock)
  const [edit, setEdit] = useState<{ quantity: number; limit: number; value: string } | null>(null)
  const draft = edit?.quantity === quantity && edit.limit === limit ? edit.value : String(quantity)
  function commit() {
    if (draft.trim() && Number.isFinite(Number(draft))) onChange(boundedQuantity(Number(draft), stock))
    setEdit(null)
  }
  return <div className={styles.control}>
    <div className="quantity">
      <button type="button" onClick={() => onChange(Math.max(0, quantity - 1))} aria-label={`Decrease ${name} quantity`}><Icon name="minus" size={16} /></button>
      <input className={styles.input} type="number" min={0} max={limit} step={1} inputMode="numeric" value={draft}
        aria-label={`${name} quantity`} aria-describedby={id}
        onChange={event => setEdit({ quantity, limit, value: event.target.value })} onBlur={commit}
        onKeyDown={event => {
          if (event.key === 'Enter') { event.preventDefault(); commit() }
          if (event.key === 'Escape') { event.preventDefault(); setEdit(null) }
        }} />
      <button type="button" disabled={quantity >= limit} aria-describedby={id} onClick={() => onChange(quantity + 1)} aria-label={`Increase ${name} quantity`}><Icon name="plus" size={16} /></button>
    </div>
    <small id={id}>Limit: {limit} (up to 99 per item, subject to stock). Enter 0 to remove.</small>
  </div>
}

'use client'
import Link from 'next/link'
import { BUSINESS_TIMEZONE } from '@/lib/format/business-time'
import type { PaymentReceipt } from '@/features/pos/domain'
import { Dialog } from '@/components/ui/Dialog'
import { formatWon } from '@/lib/format/currency'
export type ReceiptLine = { name: string; quantity: number; lineTotalWon: number }
export function ReceiptDialog({ receipt, items, onClose, canReadRefunds = false }: { receipt: PaymentReceipt; items: ReceiptLine[]; onClose(): void; canReadRefunds?: boolean }) {
  return <Dialog title="Payment completed" onClose={onClose}>
    <div className="sale-receipt">
      <p className="eyebrow">MICA Money</p><strong>{receipt.receipt_number}</strong>
      <p className="muted">{new Date(receipt.created_at).toLocaleString(undefined, { timeZone: BUSINESS_TIMEZONE })} KST</p>
      <dl className="tender-summary">{items.map((item, index) => <div key={`${item.name}-${index}`}><dt>{item.name} × {item.quantity}</dt><dd>{formatWon(item.lineTotalWon)}</dd></div>)}
        {receipt.discount_won > 0 && <><div><dt>Subtotal</dt><dd>{formatWon(receipt.subtotal_won)}</dd></div><div><dt>{receipt.coupon_name ?? 'Coupon'}</dt><dd>−{formatWon(receipt.discount_won)}</dd></div></>}
        <div className="total-row"><dt>Total</dt><dd>{formatWon(receipt.total_won)}</dd></div>
        {receipt.tender_mode !== 'CASH' && <div><dt>MICA Money</dt><dd>{formatWon(receipt.wallet_tender_won)}</dd></div>}
        {receipt.tender_mode !== 'WALLET' && <><div><dt>Cash</dt><dd>{formatWon(receipt.cash_tender_won)}</dd></div><div><dt>Cash received</dt><dd>{formatWon(receipt.cash_received_won ?? 0)}</dd></div><div><dt>Change</dt><dd>{formatWon(receipt.change_given_won ?? 0)}</dd></div></>}
        {receipt.balance_after_won !== null && <div><dt>MICA Money balance</dt><dd>{formatWon(receipt.balance_after_won)}</dd></div>}
      </dl>
    </div><div className="action-row"><button data-dialog-initial-focus className="primary-action" onClick={onClose}>Start next sale</button>{canReadRefunds && <Link className="secondary-action" href={`/refunds?reference=${encodeURIComponent(receipt.receipt_number)}`}>Review refund options</Link>}</div>
  </Dialog>
}

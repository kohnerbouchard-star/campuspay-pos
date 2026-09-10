import { formatWon } from '@/lib/format/currency'
export function Money({ amount }: { amount: number }) {
  return <span className={`money${amount < 0 ? ' negative' : ''}`}>{formatWon(amount)}</span>
}

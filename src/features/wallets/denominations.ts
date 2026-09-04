import { ALLOWED_DENOMINATIONS_WON } from '@/features/wallets/domain'

export function adjustmentTotal(values: readonly number[]): number {
  const allowed = new Set<number>(ALLOWED_DENOMINATIONS_WON)
  if (!values.length || values.some((value) => !allowed.has(value))) {
    throw new Error('Only predefined denominations are permitted')
  }
  return values.reduce((sum, value) => sum + value, 0)
}

export function projectedWalletBalance(current: number, direction: 'CREDIT'|'DEBIT', amount: number): number {
  return direction === 'CREDIT' ? current + amount : current - amount
}

export function debtFromBalance(balance: number): number {
  return Math.max(0, -balance)
}

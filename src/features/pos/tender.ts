import type { TenderMode } from '@/features/pos/domain'

/** UI preview only. The database validates these amounts against its final sale total. */
export function previewTender(totalWon: number, mode: TenderMode, walletInput: string, cashInput: string) {
  const wholeWon = (value: string) => /^\d+$/.test(value) && Number.isSafeInteger(Number(value)) && Number(value) <= 1_000_000_000 ? Number(value) : null
  const walletWon = mode === 'WALLET' ? totalWon : mode === 'CASH' ? 0 : wholeWon(walletInput)
  const validWallet = walletWon !== null && walletWon >= 0 && walletWon <= totalWon && (mode !== 'SPLIT' || (walletWon > 0 && walletWon < totalWon))
  const cashDueWon = validWallet ? totalWon - walletWon! : null
  const cashReceivedWon = mode === 'WALLET' ? null : wholeWon(cashInput)
  const validCash = mode === 'WALLET' || (cashReceivedWon !== null && cashDueWon !== null && cashReceivedWon >= cashDueWon)
  return { walletWon, cashDueWon, cashReceivedWon, changeWon: cashReceivedWon !== null && cashDueWon !== null ? Math.max(0, cashReceivedWon - cashDueWon) : null, validWallet, validCash }
}

export function validSplitContribution(total: number, serverMaximum: number, input: string) {
  return previewTender(total, 'SPLIT', input, '').validWallet && Number(input) <= serverMaximum
}

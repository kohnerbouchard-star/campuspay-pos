import { describe, expect, it } from 'vitest'
import { summarizeSales, type SalesRow } from '@/features/reports/summary'
describe('sale reporting reconciliation', () => {
  it('counts a split sale once and excludes cash received and change from revenue', () => {
    const row: SalesRow = { receipt_number: 'SALE-1', sold_at: '2026-09-07T03:00:00Z', cashier_name: 'Cashier', channel: 'POS', subtotal_won: 12000, discount_won: 0, revenue_won: 12000, cogs_won: 4000, gross_profit_won: 8000, coupon_name: null, coupon_code_masked: null, student_name: 'Student', balance_after_won: 0, tender_mode: 'SPLIT', wallet_tender_won: 7000, cash_tender_won: 5000, cash_received_won: 10000, change_given_won: 5000 }
    expect(summarizeSales([row])).toEqual({ revenue: 12000, cogs: 4000, profit: 8000, wallet: 7000, cash: 5000, pos: 12000, online: 0, splits: 1 })
  })
})

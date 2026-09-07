import type { z } from 'zod'
import type { SalesReportRowSchema } from '@/features/reports/domain'
export type SalesRow = z.infer<typeof SalesReportRowSchema>
export function summarizeSales(rows: readonly SalesRow[]) {
  return rows.reduce((sum, row) => ({
    revenue: sum.revenue + row.revenue_won, cogs: sum.cogs + row.cogs_won,
    profit: sum.profit + row.gross_profit_won, wallet: sum.wallet + row.wallet_tender_won,
    cash: sum.cash + row.cash_tender_won, pos: sum.pos + (row.channel === 'POS' ? row.revenue_won : 0),
    online: sum.online + (row.channel === 'ONLINE_STORE' ? row.revenue_won : 0),
    splits: sum.splits + Number(row.tender_mode === 'SPLIT'),
  }), { revenue: 0, cogs: 0, profit: 0, wallet: 0, cash: 0, pos: 0, online: 0, splits: 0 })
}

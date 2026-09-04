'use client'

import { WalletSearch } from '@/features/wallets/ui/WalletSearch'
import { AdjustmentPanel } from '@/features/wallets/ui/AdjustmentPanel'
import { CouponReportPanel } from '@/features/coupons/ui/CouponReportPanel'

export function AccountingScreen() {
  return <main className="workspace">
    <header className="workspace-header">
      <div><p className="eyebrow">Accounting</p><h1>Student wallets and debt</h1></div>
      <span className="status-pill">Ledger only</span>
    </header>
    <div className="dashboard-grid">
      <AdjustmentPanel />
      <WalletSearch />
      <CouponReportPanel />
    </div>
  </main>
}

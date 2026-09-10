'use client'
import { useState } from 'react'
import { WalletSearch } from '@/features/wallets/ui/WalletSearch'
import { AdjustmentPanel } from '@/features/wallets/ui/AdjustmentPanel'
import { SalesReport } from '@/features/reports/ui/SalesReport'
export function AccountingScreen() {
  const [tab, setTab] = useState<'wallets' | 'sales'>('wallets')
  const [revision, setRevision] = useState(0)
  return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Finance operations</p><h1>Accounting</h1><p>Manage student funds and reconcile sales.</p></div><span className="status-pill">All changes recorded</span></header>
    <div className="segmented" aria-label="Accounting view"><button aria-pressed={tab === 'wallets'} className={tab === 'wallets' ? 'active' : ''} onClick={() => setTab('wallets')}>Student wallets</button><button aria-pressed={tab === 'sales'} className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>Sales & payments</button></div>
    {tab === 'wallets' ? <div className="form-stack"><AdjustmentPanel onPosted={() => setRevision(value => value + 1)} /><WalletSearch key={revision} /></div> : <SalesReport />}
  </main>
}

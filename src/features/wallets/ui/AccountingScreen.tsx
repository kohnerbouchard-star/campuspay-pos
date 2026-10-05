'use client'
import { useState } from 'react'
import { WalletSearch } from '@/features/wallets/ui/WalletSearch'

import { SalesReport } from '@/features/reports/ui/SalesReport'
export function AccountingScreen({funding=false}:{funding?:boolean}) {
  const [tab, setTab] = useState<'wallets' | 'sales'>('wallets')
  const [revision, setRevision] = useState(0)
  return <main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Finance operations</p><h1>Accounting</h1><p>Manage student funds and reconcile sales.</p></div><span className="status-pill">All changes recorded</span></header>
    <div className="segmented" aria-label="Accounting view"><button aria-pressed={tab === 'wallets'} className={tab === 'wallets' ? 'active' : ''} onClick={() => setTab('wallets')}>Student wallets</button><button aria-pressed={tab === 'sales'} className={tab === 'sales' ? 'active' : ''} onClick={() => setTab('sales')}>Sales & payments</button></div>
    {tab === 'wallets' ? <div className="form-stack">{funding?<section className="panel"><h2>Wallet funding</h2><p>Use the controlled workflow for cash deposits, independently approved non-cash credits and deductions, and original-receipt reversals.</p><a className="primary-action" href="/funding">Open wallet funding</a></section>:<section className="panel"><h2>Student funding</h2><p>Open a student record to add funds. Funding readiness and recovery remain visible in that workflow.</p><a className="primary-action" href="/students">Find student</a></section>}<WalletSearch key={revision} /></div> : <SalesReport />}
  </main>
}

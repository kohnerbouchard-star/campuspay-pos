import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { REPORT_PERMISSIONS } from '@/features/auth/navigation'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { SalesReport } from '@/features/reports/ui/SalesReport'
import { CouponReportPanel } from '@/features/coupons/ui/CouponReportPanel'
import { InventoryReport, WalletReport } from '@/features/reports/ui/BalanceReports'
export const dynamic = 'force-dynamic'
export default async function ReportsPage() {
  const session = await requireAnyPagePermission(REPORT_PERMISSIONS, '/reports')
  const reports = [
    { permission: 'reports.sales' as const, id: 'sales-report', label: 'Sales & payments', panel: <SalesReport /> },
    { permission: 'reports.inventory' as const, id: 'inventory-report', label: 'Inventory', panel: <InventoryReport /> },
    { permission: 'reports.wallets' as const, id: 'wallet-report', label: 'Student wallets', panel: <WalletReport /> },
    { permission: 'reports.coupons' as const, id: 'coupon-report', label: 'Coupons', panel: <CouponReportPanel /> },
  ].filter(report => session.permissions.includes(report.permission))
  return <WorkspaceFrame session={session} title="Reports"><main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">School operations</p><h1>Reports</h1><p>Jump to the report you need. Each report keeps its own filters and export options.</p></div><span className="status-pill">Authorized reports</span></header>
    <nav aria-label="Jump to report" className="report-shortcuts">{reports.map(report => <a key={report.id} className="secondary-action" href={`#${report.id}`}>{report.label}</a>)}</nav>
    {session.permissions.includes('reports.sales') && <p><a className="secondary-action" href="/reconciliation">Open daily reconciliation</a></p>}
    {reports.map(report => <div className="report-section" key={report.id} id={report.id} tabIndex={-1} aria-label={`${report.label} report section`}>{report.panel}</div>)}
  </main></WorkspaceFrame>
}

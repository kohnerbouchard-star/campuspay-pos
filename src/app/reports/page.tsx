import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { REPORT_PERMISSIONS } from '@/features/auth/navigation'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { SalesReport } from '@/features/reports/ui/SalesReport'
import { CouponReportPanel } from '@/features/coupons/ui/CouponReportPanel'
import { InventoryReport, WalletReport } from '@/features/reports/ui/BalanceReports'
export const dynamic = 'force-dynamic'
export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ report?: string }> }) {
  const session = await requireAnyPagePermission(REPORT_PERMISSIONS, '/reports')
  const params = await searchParams
  const reports = [
    { permission: 'reports.sales' as const, id: 'sales-report', label: 'Sales & payments', panel: <SalesReport canReadRefunds={session.permissions.includes('refunds.read')} /> },
    { permission: 'reports.inventory' as const, id: 'inventory-report', label: 'Inventory', panel: <InventoryReport /> },
    { permission: 'reports.wallets' as const, id: 'wallet-report', label: 'Student wallets', panel: <WalletReport /> },
    { permission: 'reports.coupons' as const, id: 'coupon-report', label: 'Coupons', panel: <CouponReportPanel /> },
  ].filter(report => session.permissions.includes(report.permission))
  const selected = reports.find(report => report.id === params.report) ?? reports[0]
  return <WorkspaceFrame session={session} title="Reports"><main className="workspace">
    <header className="workspace-header"><div><p className="eyebrow">School operations</p><h1>Reports</h1><p>Choose one report to review. Only reports assigned to your account are available.</p></div></header>
    {reports.length > 1 && <form className="report-chooser" action="/reports"><label className="field"><span>Report</span><select name="report" defaultValue={selected.id}>{reports.map(report => <option key={report.id} value={report.id}>{report.label}</option>)}</select></label><button className="secondary-action">Open report</button></form>}
    {session.permissions.includes('reconciliation.read') && <p><a className="secondary-action" href="/reconciliation">Open daily reconciliation</a></p>}
    {selected && <div className="report-section" id={selected.id} tabIndex={-1} aria-label={`${selected.label} report section`}>{selected.panel}</div>}
  </main></WorkspaceFrame>
}

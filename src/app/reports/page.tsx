import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { REPORT_PERMISSIONS } from '@/features/auth/navigation'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { SalesReport } from '@/features/reports/ui/SalesReport'
import { CouponReportPanel } from '@/features/coupons/ui/CouponReportPanel'
import { InventoryReport, WalletReport } from '@/features/reports/ui/BalanceReports'
export const dynamic = 'force-dynamic'
export default async function ReportsPage() {
  const session = await requireAnyPagePermission(REPORT_PERMISSIONS, '/reports')
  return <WorkspaceFrame session={session} title="Reports"><main className="workspace"><header className="workspace-header"><div><p className="eyebrow">School operations</p><h1>Reports</h1></div><span className="status-pill">Authorized reports</span></header>
    {session.permissions.includes('reports.sales') && <SalesReport />}
    {session.permissions.includes('reports.inventory') && <InventoryReport />}
    {session.permissions.includes('reports.wallets') && <WalletReport />}
    {session.permissions.includes('reports.coupons') && <div className="section-spacer"><CouponReportPanel /></div>}
  </main></WorkspaceFrame>
}

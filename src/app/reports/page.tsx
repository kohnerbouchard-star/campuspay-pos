import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { SalesReport } from '@/features/reports/ui/SalesReport'
import { CouponReportPanel } from '@/features/coupons/ui/CouponReportPanel'
export const dynamic = 'force-dynamic'
export default async function ReportsPage() {
  const session = await requirePagePermission('reports.sales')
  return <WorkspaceFrame session={session} title="Reports"><main className="workspace"><header className="workspace-header"><div><p className="eyebrow">Accounting & performance</p><h1>Reports</h1></div><span className="status-pill">Completed transactions</span></header><SalesReport /><div className="section-spacer"><CouponReportPanel /></div></main></WorkspaceFrame>
}

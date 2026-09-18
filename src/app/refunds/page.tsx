import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { refundsEnabled } from '@/features/refunds/server'
import { RefundScreen } from '@/features/refunds/ui/RefundScreen'
export const dynamic = 'force-dynamic'
export default async function RefundsPage() {
  const session = await requirePagePermission('reports.sales')
  return <WorkspaceFrame session={session} title="Refunds"><RefundScreen enabled={refundsEnabled()} canPost={session.role === 'super_admin'} userId={session.user_id} /></WorkspaceFrame>
}

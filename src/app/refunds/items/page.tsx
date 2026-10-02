import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { partialRefundsEnabled } from '@/features/refunds/partial-server'
import { returnsEnabled } from '@/features/refunds/server'
import { PartialRefundWorkspace } from '@/features/refunds/ui/PartialRefundWorkspace'
export const dynamic = 'force-dynamic'
export default async function Page() {
  const s = await requireAnyPagePermission(['reports.sales'],'/refunds/items')
  return <WorkspaceFrame navigationHref="/refunds" session={s} title="Item refunds and returns"><PartialRefundWorkspace enabled={partialRefundsEnabled()} allowReturns={returnsEnabled()} canPost={s.role === 'super_admin'} userId={s.user_id} /></WorkspaceFrame>
}

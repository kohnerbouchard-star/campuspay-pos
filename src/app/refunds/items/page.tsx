import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { partialRefundsEnabled } from '@/features/refunds/partial-server'
import { returnsEnabled } from '@/features/refunds/server'
import { PartialRefundWorkspace } from '@/features/refunds/ui/PartialRefundWorkspace'
export const dynamic = 'force-dynamic'
export default async function Page({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  const params = await searchParams
  const reference = typeof params.reference === 'string' && params.reference.length <= 100 ? params.reference.trim() : ''
  const s = await requireAnyPagePermission(['refunds.read'],'/refunds/items')
  return <WorkspaceFrame session={s} title="Item refunds and returns"><PartialRefundWorkspace initialReference={reference} enabled={partialRefundsEnabled()} allowReturns={returnsEnabled()} canPost={s.permissions.includes('refunds.issue')} canPayout={s.permissions.includes('refunds.cash_payout')} userId={s.user_id} /></WorkspaceFrame>
}

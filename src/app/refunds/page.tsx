import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { refundsEnabled, returnsEnabled } from '@/features/refunds/server'
import { RefundScreen } from '@/features/refunds/ui/RefundScreen'
import { partialRefundPreviewEnabled } from '@/features/refunds/preview-server'
export const dynamic = 'force-dynamic'
export default async function RefundsPage({ searchParams }: { searchParams: Promise<{ reference?: string }> }) {
  const params = await searchParams
  const reference = typeof params.reference === 'string' && params.reference.length <= 100 ? params.reference.trim() : ''
  const session = await requirePagePermission('refunds.read')
  return <WorkspaceFrame session={session} title="Refunds"><RefundScreen initialReference={reference} previewEnabled={partialRefundPreviewEnabled()} enabled={refundsEnabled()} allowReturns={returnsEnabled()} canPost={session.permissions.includes('refunds.issue')} canPayout={session.permissions.includes('refunds.cash_payout')} userId={session.user_id} /></WorkspaceFrame>
}

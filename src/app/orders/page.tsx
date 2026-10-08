import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { OrderFulfillmentScreen } from '@/features/store/ui/OrderFulfillmentScreen'
export const dynamic = 'force-dynamic'
export default async function Page() {
  const session = await requirePagePermission('orders.read')
  return <WorkspaceFrame session={session} title="Online orders"><OrderFulfillmentScreen canOperate={session.permissions.includes('orders.fulfill')} /></WorkspaceFrame>
}

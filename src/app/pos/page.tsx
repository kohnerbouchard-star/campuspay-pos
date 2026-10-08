import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { POSScreen } from '@/features/pos/ui/POSScreen'
export const dynamic='force-dynamic'
export default async function Page(){const session=await requirePagePermission('pos.read');return <WorkspaceFrame session={session} title="Point of sale"><POSScreen cashierName={session.display_name} canCheckout={session.permissions.includes('pos.checkout')} canRedeem={session.permissions.includes('coupons.redeem')}/></WorkspaceFrame>}

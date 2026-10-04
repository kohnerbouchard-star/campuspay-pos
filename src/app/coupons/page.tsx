import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { administrationEnabled } from '@/features/administration/server'
import { CouponManagementScreen } from '@/features/coupons/ui/CouponManagementScreen'

export const dynamic = 'force-dynamic'

export default async function CouponsPage() {
  const session = await requirePagePermission('coupons.manage')
  return <WorkspaceFrame session={session} title="Coupons"><CouponManagementScreen userId={session.user_id} superAdmin={session.role==='super_admin'} removalEnabled={administrationEnabled()} /></WorkspaceFrame>
}

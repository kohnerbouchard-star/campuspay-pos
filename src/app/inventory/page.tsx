import { redirect } from 'next/navigation'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { InventoryScreen } from '@/features/inventory/ui/InventoryScreen'
export const dynamic='force-dynamic'
export default async function Page(){const session=await requireAnyPagePermission(['inventory.read','coupons.read'],'/inventory');if(!session.permissions.includes('inventory.read'))redirect('/coupons');return <WorkspaceFrame session={session} title="Inventory"><InventoryScreen userId={session.user_id} permissions={session.permissions}/></WorkspaceFrame>}

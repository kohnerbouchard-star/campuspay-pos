import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { InventoryScreen } from '@/features/inventory/ui/InventoryScreen'
export const dynamic='force-dynamic'
export default async function Page(){const session=await requirePagePermission('inventory.read');return <WorkspaceFrame session={session} title="Inventory"><InventoryScreen/></WorkspaceFrame>}

import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { ReconciliationScreen } from '@/features/reconciliation/ui/ReconciliationScreen'
export const dynamic='force-dynamic'
export default async function Page(){const session=await requireAnyPagePermission(['reports.sales'],'/reconciliation');return <WorkspaceFrame session={session} title="Daily reconciliation"><ReconciliationScreen/></WorkspaceFrame>}

import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { AccountingScreen } from '@/features/wallets/ui/AccountingScreen'
export const dynamic='force-dynamic'
export default async function Page(){const session=await requirePagePermission('wallet.read');return <WorkspaceFrame session={session} title="Accounting"><AccountingScreen/></WorkspaceFrame>}

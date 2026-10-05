import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { CashArchive } from '@/features/history/ui/CashArchive'
export const dynamic='force-dynamic'
export default async function Page(){const s=await requireAnyPagePermission(['cash.history.all'],'/cash/history');return <WorkspaceFrame session={s} title="Cash-close history"><CashArchive/></WorkspaceFrame>}

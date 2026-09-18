import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { cashEnabled } from '@/features/cash/server'
import { CashScreen } from '@/features/cash/ui/CashScreen'
export const dynamic = 'force-dynamic'
export default async function Page() {
 const s = await requireAnyPagePermission(['pos.checkout','reports.sales'],'/cash')
 return <WorkspaceFrame session={s} title="Cash register"><CashScreen enabled={cashEnabled()} role={s.role} userId={s.user_id} /></WorkspaceFrame>
}

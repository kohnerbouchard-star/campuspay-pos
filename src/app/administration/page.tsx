import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { administrationEnabled } from '@/features/administration/server'
import { AdministrationScreen } from '@/features/administration/ui/AdministrationScreen'
export const dynamic='force-dynamic'
export default async function Page(){const s=await requireAnyPagePermission(['security.staff.manage'],'/administration');return <WorkspaceFrame session={s} title="Staff and terminals"><AdministrationScreen enabled={administrationEnabled()} userId={s.user_id}/></WorkspaceFrame>}

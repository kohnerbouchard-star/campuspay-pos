import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { SecurityScreen } from '@/features/security/ui/SecurityScreen'
export const dynamic='force-dynamic'
export default async function Page(){const session=await requirePagePermission('security.credentials.request');return <WorkspaceFrame session={session} title="Credential security"><SecurityScreen/></WorkspaceFrame>}

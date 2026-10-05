import { fundingEnabled } from '@/features/funding/server'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { StudentsScreen } from '@/features/students/ui/StudentsScreen'

export const dynamic = 'force-dynamic'
export default async function Page() {
  const session = await requirePagePermission('students.read')
  return <WorkspaceFrame session={session} title="Students"><StudentsScreen userId={session.user_id} permissions={session.permissions} fundingEnabled={fundingEnabled()} /></WorkspaceFrame>
}

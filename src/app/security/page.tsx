import { z } from 'zod'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { searchSecurityStudents } from '@/features/security/server'
import { SecurityScreen } from '@/features/security/ui/SecurityScreen'

export const dynamic = 'force-dynamic'
export default async function Page({ searchParams }: { searchParams: Promise<{ studentId?: string }> }) {
  const session = await requirePagePermission('security.credentials.request')
  const { studentId } = await searchParams
  const parsed = z.string().uuid().safeParse(studentId)
  const initialStudent = parsed.success ? (await searchSecurityStudents(session, parsed.data))[0] : undefined
  return <WorkspaceFrame session={session} title="Credential security"><SecurityScreen canEnroll={session.role === 'super_admin'} initialStudent={initialStudent} /></WorkspaceFrame>
}

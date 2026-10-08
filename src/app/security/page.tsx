import { z } from 'zod'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { searchSecurityStudents } from '@/features/security/server'
import { SecurityScreen } from '@/features/security/ui/SecurityScreen'

export const dynamic = 'force-dynamic'
export default async function Page({ searchParams }: { searchParams: Promise<{ studentId?: string;purpose?: string }> }) {
  const session = await requireAnyPagePermission(['credentials.reset','credentials.card.replace'],'/security')
  const { studentId,purpose } = await searchParams
  const parsed = z.string().uuid().safeParse(studentId)
  const initialStudent = parsed.success ? (await searchSecurityStudents(session, parsed.data))[0] : undefined
  return <WorkspaceFrame session={session} title="Credential security"><SecurityScreen initialStudent={initialStudent} permissions={session.permissions} initialPurpose={purpose==='RESET_STUDENT_CARD'?'RESET_STUDENT_CARD':undefined} /></WorkspaceFrame>
}

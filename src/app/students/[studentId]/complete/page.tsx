import { notFound } from 'next/navigation'
import { z } from 'zod'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { requirePagePermission } from '@/features/auth/server/page-guard'
import { searchRosterStudents } from '@/features/students/server'
import { isRosterIssuanceEnabled } from '@/features/students/completion-server'
import { CompletionScreen } from '@/features/students/ui/CompletionScreen'

export const dynamic = 'force-dynamic'
export default async function Page({ params }: { params: Promise<{ studentId: string }> }) {
  const session = await requirePagePermission('students.enroll')
  const { studentId } = await params
  if (!z.string().uuid().safeParse(studentId).success) notFound()
  const [student] = await searchRosterStudents(session, { query: studentId, yearGroup: null, offset: 0 })
  if (!student || student.student_id !== studentId) notFound()
  return <WorkspaceFrame session={session} title="Complete enrollment"><CompletionScreen student={student} enabled={isRosterIssuanceEnabled()} /></WorkspaceFrame>
}

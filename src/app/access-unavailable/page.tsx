import { authorizeAnyRequest } from '@/features/auth/server/session'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
import { redirect } from 'next/navigation'
import { ApiError } from '@/lib/api/errors'
export const dynamic = 'force-dynamic'
export default async function Page() {
 const session = await authorizeAnyRequest().catch(error => {
  if (error instanceof ApiError && error.status === 401) redirect('/login?next=%2Faccess-unavailable&expired=1')
  throw error
 })
 return <WorkspaceFrame session={session} title="Access"><main className="workspace"><h1>No workspaces assigned</h1><p>Ask a Super Admin to review your employee access. Your preset alone does not grant access.</p></main></WorkspaceFrame>
}

import { authorizeAnyRequest } from '@/features/auth/server/session'
import { WorkspaceFrame } from '@/components/WorkspaceFrame'
export const dynamic = 'force-dynamic'
export default async function Page() {
 const session = await authorizeAnyRequest()
 return <WorkspaceFrame session={session} title="Access"><main className="workspace"><h1>No workspaces assigned</h1><p>Ask a Super Admin to review your employee access. Your preset alone does not grant access.</p></main></WorkspaceFrame>
}

import { redirect } from 'next/navigation'
import { authorizeAnyRequest } from '@/features/auth/server/session'
import { defaultWorkspace } from '@/features/auth/permissions'
import { ApiError } from '@/lib/api/errors'
export const dynamic = 'force-dynamic'
export default async function Home() {
  let session
  try { session = await authorizeAnyRequest() }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) redirect('/login')
    throw error
  }
  redirect(defaultWorkspace(session.role))
}

import 'server-only'
import { redirect } from 'next/navigation'
import { toApiError } from '@/lib/api/errors'
import { readCustomerSessionCookie } from '@/lib/http/cookies'
import { customerLoginPath } from '@/features/store/navigation'
import { authorizeCustomerSession } from '@/features/store/server/session'

export async function requireCustomerPage(destination: string) {
  try { return await authorizeCustomerSession() }
  catch (error) {
    if (toApiError(error).status !== 401) throw error
    redirect(customerLoginPath(destination, Boolean(await readCustomerSessionCookie())))
  }
}

import { redirect } from 'next/navigation'
import { toApiError } from '@/lib/api/errors'
import { readCustomerSessionCookie } from '@/lib/http/cookies'
import { authorizeCustomerSession } from '@/features/store/server/session'
import { safeCustomerDestination } from '@/features/store/navigation'
import { CustomerLoginScreen } from '@/features/store/ui/CustomerLoginScreen'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Sign in · MICA Money' }
export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams
  const destination = safeCustomerDestination(params.next)
  let signedIn = false
  if (await readCustomerSessionCookie()) {
    try { await authorizeCustomerSession(); signedIn = true }
    catch (error) { if (toApiError(error).status !== 401) throw error }
  }
  if (signedIn) redirect(destination)
  return <CustomerLoginScreen destination={destination} expired={params.reason === 'expired'} />
}

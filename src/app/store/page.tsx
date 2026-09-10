import { StorefrontScreen } from '@/features/store/ui/StorefrontScreen'
import { requireCustomerPage } from '@/features/store/server/page-guard'
import { customerProfile } from '@/features/store/presentation'
export const dynamic = 'force-dynamic'
export default async function Page() {
  const session = await requireCustomerPage('/store')
  return <StorefrontScreen initialSession={customerProfile(session)} />
}

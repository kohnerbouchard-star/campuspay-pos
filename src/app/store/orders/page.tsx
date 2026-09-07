import { CustomerOrdersScreen } from '@/features/store/ui/CustomerOrdersScreen'
import { requireCustomerPage } from '@/features/store/server/page-guard'
import { customerProfile } from '@/features/store/presentation'
export const dynamic = 'force-dynamic'
export default async function Page() {
  const session = await requireCustomerPage('/store/orders')
  return <CustomerOrdersScreen session={customerProfile(session)} />
}

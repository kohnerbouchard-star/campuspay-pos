import { redirect } from 'next/navigation'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { FINANCE_PERMISSIONS, visibleSections } from '@/features/auth/navigation'
export const dynamic = 'force-dynamic'
export default async function Page() {
 const session = await requireAnyPagePermission(FINANCE_PERMISSIONS, '/finance')
 redirect(visibleSections(session.permissions, 'Finance')[0]?.href ?? '/access-unavailable')
}

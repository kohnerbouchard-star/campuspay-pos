import { redirect } from 'next/navigation'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { ADMIN_PERMISSIONS, visibleSections } from '@/features/auth/navigation'
export const dynamic = 'force-dynamic'
export default async function Page() {
 const session = await requireAnyPagePermission(ADMIN_PERMISSIONS, '/admin')
 redirect(visibleSections(session.permissions, 'Admin')[0]?.href ?? '/access-unavailable')
}

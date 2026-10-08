import { redirect } from 'next/navigation'
import { requireAnyPagePermission } from '@/features/auth/server/page-guard'
import { REGISTER_PERMISSIONS, visibleSections } from '@/features/auth/navigation'
export const dynamic = 'force-dynamic'
export default async function Page() {
 const session = await requireAnyPagePermission(REGISTER_PERMISSIONS, '/register')
 redirect(visibleSections(session.permissions, 'Register')[0]?.href ?? '/access-unavailable')
}

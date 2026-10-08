import { redirect } from 'next/navigation'
import { requirePagePermission } from '@/features/auth/server/page-guard'
export const dynamic='force-dynamic'
export default async function Page(){await requirePagePermission('wallet.read');redirect('/students')}

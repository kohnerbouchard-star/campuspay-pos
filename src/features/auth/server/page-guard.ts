import 'server-only'
import { redirect } from 'next/navigation'
import type { Permission } from '@/features/auth/domain'
import { authorizeRequest } from '@/features/auth/server/session'

export async function requirePagePermission(permission: Permission) {
  try { return await authorizeRequest(permission) }
  catch { redirect('/') }
}

import 'server-only'
import { redirect } from 'next/navigation'
import type { Permission } from '@/features/auth/domain'
import { authorizeRequest } from '@/features/auth/server/session'
import { ApiError } from '@/lib/api/errors'
import { WORKSPACE_LINKS } from '@/features/auth/navigation'

export async function requirePagePermission(permission: Permission) {
  try { return await authorizeRequest(permission) }
  catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      const next = WORKSPACE_LINKS.find(link => link.permission === permission)?.href ?? '/'
      redirect(`/login?next=${encodeURIComponent(next)}&expired=1`)
    }
    if (error instanceof ApiError && error.status === 403) redirect('/')
    throw error
  }
}

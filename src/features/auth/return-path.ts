import { WORKSPACE_LINKS } from '@/features/auth/navigation'
import type { Permission } from '@/features/auth/domain'
export function safeStaffReturn(value: string | undefined, permissions: readonly Permission[], fallback: string): string {
  if (!value || /[\\\r\n]/.test(value)) return fallback
  const route = WORKSPACE_LINKS.find(link => link.href === value)
  return route && permissions.includes(route.permission) ? route.href : fallback
}

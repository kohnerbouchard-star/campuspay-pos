import { STAFF_SECTIONS, WORKSPACE_LINKS, canAccessWorkspace } from './navigation'
import type { Permission } from './domain'
export function safeStaffReturn(value: string | undefined, permissions: readonly Permission[], fallback: string): string {
  if (!value || /[\\\r\n]/.test(value)) return fallback
  const route = WORKSPACE_LINKS.find(link => link.href === value)
  if (route && canAccessWorkspace(permissions, route)) return route.href
  const section = STAFF_SECTIONS.find(s => s.href === value)
  return section && section.anyPermissions.some(p => permissions.includes(p)) ? section.href : fallback
}

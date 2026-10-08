'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import type { Permission } from '@/features/auth/domain'
import { WORKSPACE_LINKS, activeWorkspace, visibleSections } from '@/features/auth/navigation'
export function WorkspaceSections({ permissions }: { permissions: readonly Permission[] }) {
  const path = usePathname(), workspace = activeWorkspace(path, WORKSPACE_LINKS)
  const sections = visibleSections(permissions, workspace?.label ?? '')
  if (sections.length < 2) return null
  return <nav className="workspace-sections" aria-label={`${workspace?.label} sections`}>{sections.map(s => <Link key={s.href} href={s.href} prefetch={false} aria-current={path === s.href ? 'page' : undefined}>{s.label}</Link>)}</nav>
}

'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { activeWorkspace, type WorkspaceLink } from '@/features/auth/navigation'
import styles from './navigation.module.css'

export function WorkspaceBreadcrumbs({ links, title }: { links: readonly WorkspaceLink[]; title: string }) {
  const pathname = usePathname()
  const current = activeWorkspace(pathname, links)
  if (!current) return null
  const nested = pathname.replace(/\/+$/, '') !== current.href
  return <nav className={styles.breadcrumbs} aria-label="Breadcrumb">
    <ol><li>{current.group}</li><li aria-hidden="true">/</li>
      {nested ? <><li><Link href={current.href} prefetch={false}>Back to {current.label}</Link></li><li aria-hidden="true">/</li><li aria-current="page">{title}</li></>
        : <li aria-current="page">{current.label}</li>}
    </ol>
  </nav>
}

import Link from 'next/link'
import { activeWorkspace, workspaceGroups, type WorkspaceLink } from '@/features/auth/navigation'
import { Icon, type IconName } from '@/components/ui/Icon'
import styles from './navigation.module.css'

const WORKSPACE_ICONS: Readonly<Record<string, IconName>> = {
  '/pos': 'register',
  '/orders': 'bag',
  '/students': 'users',
  '/inventory': 'box',
  '/coupons': 'tag',
  '/accounting': 'wallet',
  '/funding': 'plus',
  '/cash': 'cash',
  '/refunds': 'refund',
  '/reconciliation': 'check',
  '/reports': 'chart',
  '/security': 'shield',
  '/administration': 'building',
  '/settings/payments': 'settings',
}

export function WorkspaceLinks({ links, pathname, onNavigate, detailed = false }: {
  links: readonly WorkspaceLink[]; pathname: string; onNavigate?(): void; detailed?: boolean
}) {
  const current = activeWorkspace(pathname, links)
  return <nav aria-label="Permitted workspaces" className={styles.links}>
    {workspaceGroups(links).map(group => <section key={group.label} className={styles.group} aria-label={group.label}>
      <h2>{group.label}</h2>
      <ul>{group.links.map(link => <li key={link.href}>
        <Link href={link.href} prefetch={false} onClick={onNavigate} title={link.description}
          className={styles.link} data-active={current?.href === link.href || undefined}
          aria-current={current?.href === link.href ? (pathname.replace(/\/+$/, '') === link.href ? 'page' : 'location') : undefined}>
          <Icon name={WORKSPACE_ICONS[link.href] ?? 'grid'} size={18} className={styles.linkIcon} />
          <span className={styles.linkText}><span className={styles.linkLabel}>{link.label}</span>
            {detailed && <small>{link.description}</small>}
          </span>
        </Link>
      </li>)}</ul>
    </section>)}
  </nav>
}

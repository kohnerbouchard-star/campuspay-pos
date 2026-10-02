import Link from 'next/link'
import { activeWorkspace, workspaceGroups, type WorkspaceLink } from '@/features/auth/navigation'
import styles from './navigation.module.css'

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
          <span className={styles.linkLabel}>{link.label}</span>
          {detailed && <small>{link.description}</small>}
        </Link>
      </li>)}</ul>
    </section>)}
  </nav>
}

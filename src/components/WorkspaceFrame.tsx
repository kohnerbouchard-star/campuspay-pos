import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SessionContext } from '@/features/auth/domain'
import { WORKSPACE_LINKS, canAccessWorkspace } from '@/features/auth/navigation'
import { LogoutButton } from '@/components/LogoutButton'
import { StaffSessionGuard } from '@/features/terminal/StaffSessionGuard'

export function WorkspaceFrame({ session, title, children }: {
  session: SessionContext
  title: string
  children: ReactNode
}) {
  const parentTitle = ({ 'Cash-close history': 'Cash register', 'Item refunds and returns': 'Refunds', 'Complete enrollment': 'Students' } as Record<string, string>)[title] ?? title
  const allowedLinks = WORKSPACE_LINKS.filter((link) => canAccessWorkspace(session.permissions, link))

  return <div className="app-shell">
    <a className="skip-link" href="#workspace-content">Skip to workspace</a>
    <aside className="side-rail">
      <Link href="/" className="rail-brand"><span>M</span><div><strong>MICA Money</strong><small>Staff operations</small></div></Link>
      <div className="role-card">
        <small>Signed in</small>
        <strong>{session.display_name}</strong>
        <span>{session.role.replaceAll('_', ' ')}</span>
      </div>
      <nav aria-label="Permitted workspaces">
        {allowedLinks.map((link) => <Link
          className={link.title === parentTitle ? 'active-nav' : 'nav-link'}
          aria-current={link.title === parentTitle ? 'page' : undefined}
          prefetch={false}
          href={link.href}
          key={link.href}
        >{link.label}</Link>)}
      </nav>
      <LogoutButton />
    </aside>
    <div className="main-stage" id="workspace-content" tabIndex={-1}><StaffSessionGuard />{children}</div>
  </div>
}

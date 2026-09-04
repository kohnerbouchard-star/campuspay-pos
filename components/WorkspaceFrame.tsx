import Link from 'next/link'
import type { ReactNode } from 'react'
import type { SessionContext } from '@/features/auth/domain'
import { WORKSPACE_LINKS } from '@/features/auth/navigation'
import { LogoutButton } from '@/components/LogoutButton'

export function WorkspaceFrame({ session, title, children }: {
  session: SessionContext
  title: string
  children: ReactNode
}) {
  const allowedLinks = WORKSPACE_LINKS.filter((link) => session.permissions.includes(link.permission))

  return <div className="app-shell">
    <aside className="side-rail">
      <div className="rail-brand"><span>CP</span><strong>CampusPay</strong></div>
      <div className="role-card">
        <small>Signed in</small>
        <strong>{session.display_name}</strong>
        <span>{session.role.replaceAll('_', ' ')}</span>
      </div>
      <nav aria-label="Permitted workspaces">
        {allowedLinks.map((link) => <Link
          className={link.title === title ? 'active-nav' : 'nav-link'}
          href={link.href}
          key={link.href}
        >{link.label}</Link>)}
      </nav>
      <LogoutButton />
    </aside>
    <div className="main-stage">{children}</div>
  </div>
}

import type { ReactNode } from 'react'
import type { SessionContext } from '@/features/auth/domain'
import { WORKSPACE_LINKS, canAccessWorkspace } from '@/features/auth/navigation'
import { StaffSessionGuard } from '@/features/terminal/StaffSessionGuard'
import { StaffNavigation } from '@/components/navigation/StaffNavigation'
import { WorkspaceBreadcrumbs } from '@/components/navigation/WorkspaceBreadcrumbs'

export function WorkspaceFrame({ session, title, children }: {
  session: SessionContext; title: string; children: ReactNode
}) {
  const allowedLinks = WORKSPACE_LINKS.filter(link => canAccessWorkspace(session.permissions, link))
  return <div className="app-shell">
    <a className="skip-link" href="#workspace-content">Skip to workspace</a>
    <StaffNavigation links={allowedLinks} displayName={session.display_name} role={session.role} />
    <div className="main-stage" id="workspace-content" tabIndex={-1}>
      <StaffSessionGuard />
      <WorkspaceBreadcrumbs links={allowedLinks} title={title} />
      {children}
    </div>
  </div>
}

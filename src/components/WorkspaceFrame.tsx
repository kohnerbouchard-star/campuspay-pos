import type { ReactNode } from 'react'
import type { SessionContext } from '@/features/auth/domain'
import { WORKSPACE_LINKS, canAccessWorkspace } from '@/features/auth/navigation'
import { StaffSessionGuard } from '@/features/terminal/StaffSessionGuard'
import { StaffNavigation } from '@/components/navigation/StaffNavigation'
import { WorkspaceSections } from '@/components/navigation/WorkspaceSections'
import { WorkspaceBreadcrumbs } from '@/components/navigation/WorkspaceBreadcrumbs'
import { StaffSessionBoundary } from '@/features/terminal/StaffSessionBoundary'

export function WorkspaceFrame({ session, title, children }: {
  session: SessionContext; title: string; children: ReactNode
}) {
  const allowedLinks = WORKSPACE_LINKS.filter(link => canAccessWorkspace(session.permissions, link))
  return <StaffSessionBoundary><div className="app-shell">
    <a className="skip-link" href="#workspace-content">Skip to workspace</a>
    <StaffNavigation links={allowedLinks} displayName={session.display_name} role={session.preset} />
    <div className="main-stage" id="workspace-content" tabIndex={-1}>
      <StaffSessionGuard />
      <WorkspaceBreadcrumbs links={allowedLinks} title={title} />
      <WorkspaceSections permissions={session.permissions} />
      {children}
    </div>
  </div></StaffSessionBoundary>
}

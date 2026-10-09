'use client'

import { useSyncExternalStore, type ReactNode } from 'react'
import { isStaffSessionExiting, subscribeSessionExit } from './session-exit'

export function StaffSessionBoundary({ children }: { children: ReactNode }) {
  const exiting = useSyncExternalStore(subscribeSessionExit, isStaffSessionExiting, () => false)
  return <>
    <div hidden={exiting} inert={exiting} data-staff-workspace>{children}</div>
    {exiting && <main className="session-exit"><section className="panel" aria-labelledby="session-exit-heading">
      <h1 id="session-exit-heading">Workspace hidden</h1>
      <p role="status">Checking sign out. Pending operations have not been cancelled.</p>
      <p className="muted">If this screen remains, continue to sign in to check the session and retry sign out.</p>
      <a className="primary-action" href="/login?logout=unconfirmed">Continue to sign in</a>
    </section></main>}
  </>
}

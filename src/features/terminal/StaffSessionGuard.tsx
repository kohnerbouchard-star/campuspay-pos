'use client'
import { usePathname } from 'next/navigation'
import { STAFF_INACTIVITY_MS } from './inactivity'
import { useInactivityLock } from './use-inactivity-lock'

function StaffWorkspaceActivity({ path }: { path: string }) {
  const { warning, remainingMs, noteActivity } = useInactivityLock(null, STAFF_INACTIVITY_MS, path)
  return warning ? <div className="timeout-warning" role="status">Workspace locks in {Math.ceil(remainingMs / 1000)} seconds. <button className="secondary-action" onClick={noteActivity}>Stay signed in</button></div> : null
}

export function StaffSessionGuard() {
  const path = usePathname()
  // The register owns its bounded payment protection and five-minute timer.
  return path === '/pos' ? null : <StaffWorkspaceActivity key={path} path={path} />
}

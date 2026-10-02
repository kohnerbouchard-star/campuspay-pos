'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { StaffRole } from '@/features/auth/domain'
import type { WorkspaceLink } from '@/features/auth/navigation'
import { Dialog } from '@/components/ui/Dialog'
import { LogoutButton } from '@/components/LogoutButton'
import { WorkspaceLinks } from './WorkspaceLinks'
import styles from './navigation.module.css'

const ROLE_LABELS: Record<StaffRole, string> = {
  cashier: 'Cashier', inventory_admin: 'Inventory administrator', accountant: 'Accountant', super_admin: 'Super Admin',
}
function Brand() {
  return <Link href="/" className={styles.brand} aria-label="MICA Money · return to your starting workspace">
    <span aria-hidden="true">M</span><div><strong>MICA Money</strong><small>Staff operations</small></div>
  </Link>
}
function MobileMenu({ links, pathname, onClose, displayName, role }: {
  links: readonly WorkspaceLink[]; pathname: string; onClose(): void; displayName: string; role: StaffRole
}) {
  useEffect(() => {
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.body.style.overflow = previous }
  }, [])
  return <Dialog title="Workspaces" className={styles.drawer} onClose={onClose}>
    <p className={styles.menuHint}>Choose a task. Only workspaces available to your account are shown.</p>
    <WorkspaceLinks links={links} pathname={pathname} onNavigate={onClose} detailed />
    <div className={styles.menuAccount}><p><strong>{displayName}</strong><small>{ROLE_LABELS[role]}</small></p><LogoutButton /></div>
  </Dialog>
}

export function StaffNavigation({ links, displayName, role }: {
  links: readonly WorkspaceLink[]; displayName: string; role: StaffRole
}) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const rail = useRef<HTMLElement>(null)
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1101px)')
    const resized = () => {
      if (!desktop.matches || !open) return
      setOpen(false)
      requestAnimationFrame(() => rail.current?.querySelector<HTMLAnchorElement>('a[data-active], a')?.focus())
    }
    desktop.addEventListener('change', resized)
    return () => desktop.removeEventListener('change', resized)
  }, [open])
  return <>
    <aside ref={rail} className={styles.rail} aria-label="Staff navigation">
      <Brand />
      <WorkspaceLinks links={links} pathname={pathname} />
      <div className={styles.account}><p><small>Signed in</small><strong>{displayName}</strong><small>{ROLE_LABELS[role]}</small></p><LogoutButton /></div>
    </aside>
    <header className={styles.mobileHeader}>
      <Brand />
      <button type="button" className={styles.menuButton} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" /></svg>Menu</button>
    </header>
    {open && <MobileMenu links={links} pathname={pathname} onClose={() => setOpen(false)} displayName={displayName} role={role} />}
  </>
}

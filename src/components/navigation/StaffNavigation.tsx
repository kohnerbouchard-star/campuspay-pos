'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import type { StaffRole } from '@/features/auth/domain'
import type { WorkspaceLink } from '@/features/auth/navigation'
import { Dialog } from '@/components/ui/Dialog'
import { Icon } from '@/components/ui/Icon'
import { LogoutButton } from '@/components/LogoutButton'
import { WorkspaceLinks } from './WorkspaceLinks'
import styles from './navigation.module.css'

const ROLE_LABELS: Record<StaffRole, string> = {
  cashier: 'Cashier', inventory_admin: 'Inventory administrator', accountant: 'Accountant', super_admin: 'Super Admin',
}
function Brand() {
  return <Link href="/" className={styles.brand} aria-label="CampusPay · return to your starting workspace">
    <span aria-hidden="true"><Icon name="card" size={23} /></span><div><strong>CampusPay</strong><small>MICA staff operations</small></div>
  </Link>
}
function AccountIdentity({ displayName, role }: { displayName: string; role: StaffRole }) {
  const initials = displayName.trim().split(/\s+/).slice(0, 2).map(part => Array.from(part)[0] ?? '').join('').toUpperCase()
  return <div className={styles.accountIdentity}>
    <span className={styles.avatar} aria-hidden="true">{initials || 'S'}</span>
    <p><small>Signed in</small><strong>{displayName}</strong><small>{ROLE_LABELS[role]}</small></p>
  </div>
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
    <div className={styles.menuAccount}><AccountIdentity displayName={displayName} role={role} /><LogoutButton /></div>
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
      <div className={styles.account}><AccountIdentity displayName={displayName} role={role} /><LogoutButton /></div>
    </aside>
    <header className={styles.mobileHeader}>
      <Brand />
      <button type="button" className={styles.menuButton} aria-haspopup="dialog" aria-expanded={open}
        onClick={() => setOpen(true)}><Icon name="menu" />Menu</button>
    </header>
    {open && <MobileMenu links={links} pathname={pathname} onClose={() => setOpen(false)} displayName={displayName} role={role} />}
  </>
}

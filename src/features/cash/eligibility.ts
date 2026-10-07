import type { Permission } from '@/features/auth/domain'
import type { CashSnapshot } from './domain'

type Eligibility =
  | { allowed: true; operation: 'OPEN' | 'CLOSE'; shiftId: string | null }
  | { allowed: false; reason: string }

// This controls new requests only. Existing recovery stays under server authority.
export function cashCountEligibility(snapshot: CashSnapshot | null, current: boolean, permissions: readonly Permission[], userId: string, enabled: boolean): Eligibility {
  if (!current || !snapshot) return { allowed: false, reason: 'Refresh the cash register before submitting a count. The current drawer could not be confirmed.' }
  if (!permissions.includes('cash.shift.manage')) return { allowed: false, reason: 'Cash shift management access is not assigned.' }
  const shift = snapshot.current_shift
  if (shift) {
    if (shift.terminal_id !== snapshot.terminal_id || shift.closed_at !== null) return { allowed: false, reason: 'Refresh the cash register. This is not an open drawer at the current terminal.' }
    if (shift.opened_by !== userId && !permissions.includes('cash.drawer.override')) return { allowed: false, reason: 'This drawer was opened by another operator. Its owner or an operator with drawer override access must close it at this terminal.' }
    return { allowed: true, operation: 'CLOSE', shiftId: shift.shift_id }
  }
  if (!enabled || !snapshot.enabled) return { allowed: false, reason: 'New cash shifts are disabled. Existing shifts may still be closed and recovered.' }
  return { allowed: true, operation: 'OPEN', shiftId: null }
}

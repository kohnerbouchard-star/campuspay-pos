import { describe, expect, it } from 'vitest'
import type { Permission } from '@/features/auth/domain'
import { CashShiftSchema, type CashSnapshot } from '../domain'
import { cashCountEligibility } from '../eligibility'

const owner = '60000000-0000-4000-8000-000000000001'
const other = '60000000-0000-4000-8000-000000000002'
const terminal = '60000000-0000-4000-8000-000000000003'
const shift = CashShiftSchema.parse({ shift_id: owner, terminal_id: terminal, terminal_label: 'Synthetic terminal', opened_by: owner, opened_at: '2026-10-07', closed_at: null, opening_float_won: 1000, cash_sales_won: 0, cash_payouts_won: 0, expected_won: 1000, counted_won: null, variance_won: null, close_notes: null, closed_by: null, approved_by: null, approval_notes: null, review_required: false })
const snapshot: CashSnapshot = { enabled: true, accountant_cash_enabled: false, terminal_id: terminal, current_shift: shift, closed_shifts: [], total_closed: 0 }
const manage: Permission[] = ['cash.read', 'cash.shift.manage']
const override: Permission[] = [...manage, 'cash.drawer.override']

describe('new cash count eligibility', () => {
  it('allows the drawer owner and an explicitly authorized override at this terminal', () => {
    for (const [user, permissions] of [[owner, manage], [other, override]] as const) {
      expect(cashCountEligibility(snapshot, true, permissions, user, true)).toEqual({ allowed: true, operation: 'CLOSE', shiftId: shift.shift_id })
    }
  })
  it('rejects another operator with ordinary shift management', () => {
    expect(cashCountEligibility(snapshot, true, manage, other, true)).toMatchObject({ allowed: false, reason: expect.stringContaining('another operator') })
  })
  it.each([{ permissions: [] }, { permissions: ['cash.read'] }, { permissions: ['cash.drawer.override'] }])('requires shift management, even for the owner or override: $permissions', ({ permissions }) => {
    expect(cashCountEligibility(snapshot, true, permissions as Permission[], owner, true).allowed).toBe(false)
  })
  it('never permits another terminal, even with explicit override', () => {
    expect(cashCountEligibility({ ...snapshot, terminal_id: other }, true, override, other, true).allowed).toBe(false)
  })
  it('requires a current successful snapshot for opening and closing', () => {
    for (const value of [null, snapshot, { ...snapshot, current_shift: null }]) {
      expect(cashCountEligibility(value, false, override, owner, true).allowed).toBe(false)
    }
    expect(cashCountEligibility(null, true, override, owner, true).allowed).toBe(false)
  })
  it('rejects a closed shift mislabeled as current', () => {
    expect(cashCountEligibility({ ...snapshot, current_shift: { ...shift, closed_at: '2026-10-07' } }, true, override, owner, true).allowed).toBe(false)
  })
  it('preserves authorized closing during a posting shutdown', () => {
    expect(cashCountEligibility({ ...snapshot, enabled: false }, true, manage, owner, false).allowed).toBe(true)
  })
  it('retains both opening activation gates', () => {
    const empty = { ...snapshot, current_shift: null }
    expect(cashCountEligibility(empty, true, manage, owner, true)).toEqual({ allowed: true, operation: 'OPEN', shiftId: null })
    expect(cashCountEligibility(empty, true, manage, owner, false).allowed).toBe(false)
    expect(cashCountEligibility({ ...empty, enabled: false }, true, manage, owner, true).allowed).toBe(false)
  })
})

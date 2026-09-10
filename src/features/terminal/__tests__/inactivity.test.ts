import { describe, expect, it } from 'vitest'
import { ACTIVITY_EVENTS, POS_INACTIVITY_MS, POS_WARNING_MS, WorkstationActivity } from '../inactivity'
import { toApiError } from '@/lib/api/errors'
describe('register inactivity', () => {
  it('defaults to five minutes', () => { expect(POS_INACTIVITY_MS).toBe(300000); expect(new WorkstationActivity(0).snapshot(299999).locked).toBe(false); expect(new WorkstationActivity(0).snapshot(300000).locked).toBe(true) })
  it('warns only during the final thirty seconds', () => { const timer = new WorkstationActivity(0); expect(POS_WARNING_MS).toBe(30000); expect(timer.snapshot(269999).warning).toBe(false); expect(timer.snapshot(270000).warning).toBe(true) })
  it('Stay signed in starts a fresh full window', () => { const timer = new WorkstationActivity(0); timer.activity(280000); expect(timer.snapshot(300000).remainingMs).toBe(280000) })
  it.each(ACTIVITY_EVENTS)('%s interaction resets the window', () => { const timer = new WorkstationActivity(0); timer.activity(270000); expect(timer.snapshot(270000)).toMatchObject({ remainingMs: 300000, warning: false }) })
  it('card/PIN/cash preparation remains stable past the original idle deadline', () => { const timer = new WorkstationActivity(0); timer.protect('intent', 390000, 270000); expect(timer.snapshot(330000)).toMatchObject({ remainingMs: 300000, warning: false, locked: false }) })
  it('processing and recovery share a bounded protected interval', () => { const timer = new WorkstationActivity(0); timer.protect('processing', 390000, 270000); expect(timer.snapshot(380000).locked).toBe(false); timer.protect('processing', 900000, 390000); expect(timer.snapshot(690000).locked).toBe(true) })
  it.each(['completed', 'cancelled'])('resumes a full window after payment %s', () => { const timer = new WorkstationActivity(0); timer.protect('intent', 390000, 270000); timer.protect(null, 0, 330000); expect(timer.snapshot(330000).remainingMs).toBe(300000); expect(timer.snapshot(630000).locked).toBe(true) })
  it('does not extend an abandoned intent on rerender', () => { const timer = new WorkstationActivity(0); timer.protect('intent', 120000, 0); timer.protect('intent', 999999999, 100000); expect(timer.snapshot(420000).locked).toBe(true) })
  it('server expiry remains a reauthentication error', () => { expect(toApiError(new Error('SESSION_EXPIRED'))).toMatchObject({ status: 401, code: 'SESSION_EXPIRED' }); expect(toApiError(new Error('UNAUTHENTICATED'))).toMatchObject({ status: 401 }) })
})

export const POS_INACTIVITY_MS = 5 * 60 * 1000
export const POS_WARNING_MS = 30 * 1000
export const SESSION_HEARTBEAT_MS = 5 * 1000
export const PAYMENT_RESULT_GRACE_MS = 30 * 1000
export const RECEIPT_PROTECTION_MS = 60 * 1000
export const ACTIVITY_EVENTS = ['pointerdown', 'keydown', 'touchstart'] as const

// One bounded lease per payment/receipt. Re-renders cannot extend an abandoned flow.
export class WorkstationActivity {
  private deadline: number
  private key: string | null = null
  private protectedUntil = 0
  constructor(now: number, private readonly timeoutMs = POS_INACTIVITY_MS) { this.deadline = now + timeoutMs }
  activity(now: number) { this.deadline = now + this.timeoutMs }
  protect(key: string | null, until: number, now: number) {
    if (key === this.key) return
    if (this.key) this.activity(now)
    this.key = key
    this.protectedUntil = key ? until : 0
  }
  snapshot(now: number) {
    const protectedFlow = this.key !== null && now < this.protectedUntil
    const deadline = this.key ? Math.max(this.deadline, this.protectedUntil + this.timeoutMs) : this.deadline
    const remainingMs = protectedFlow ? this.timeoutMs : Math.max(0, deadline - now)
    return { remainingMs, warning: !protectedFlow && remainingMs <= POS_WARNING_MS, locked: remainingMs === 0 }
  }
}

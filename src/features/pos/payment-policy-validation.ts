export const EVENT_PAYMENT_MESSAGES = {
  eventName: 'Enter an event name between 2 and 80 characters.',
  invalidEnd: 'Choose when to turn off event cash, using Korea Standard Time (KST).',
  pastEnd: 'The event end time has already passed. Choose a future time in Korea Standard Time (KST).',
  longEnd: 'Event cash can be enabled for at most 24 hours. Choose an earlier end time in Korea Standard Time (KST).',
} as const
/** Shared messages for the event-only, register-scoped cash policy. */
export function eventPaymentIssue(eventName: string | null, endsAt: string | null | undefined, now = Date.now()): { field: 'eventName' | 'endsAt'; message: string } | null {
  if (!eventName || eventName.trim().length < 2 || eventName.trim().length > 80) return {
    field: 'eventName', message: EVENT_PAYMENT_MESSAGES.eventName,
  }
  const end = endsAt ? Date.parse(endsAt) : NaN
  if (!Number.isFinite(end)) return { field: 'endsAt', message: EVENT_PAYMENT_MESSAGES.invalidEnd }
  if (end <= now) return { field: 'endsAt', message: EVENT_PAYMENT_MESSAGES.pastEnd }
  if (end > now + 24 * 60 * 60 * 1000) return { field: 'endsAt', message: EVENT_PAYMENT_MESSAGES.longEnd }
  return null
}

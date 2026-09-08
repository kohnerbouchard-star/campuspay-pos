/** Keep aligned with private.business_timezone(); integration tests verify both. */
export const BUSINESS_TIMEZONE = 'Asia/Seoul'
export function businessDate(value: Date = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(value)
}
export function formatBusinessTime(value: string | Date): string {
  return new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIMEZONE, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value))
}

export function businessDateTimeInput(value: Date = new Date()): string {
  const time = new Intl.DateTimeFormat('en-GB', { timeZone: BUSINESS_TIMEZONE, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(value)
  return `${businessDate(value)}T${time}`
}
export function businessDateTimeToIso(value: string): string {
  // Korea Standard Time is UTC+09:00 throughout the year.
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) throw new Error('Choose a valid Korea date and time.')
  return new Date(`${value}:00+09:00`).toISOString()
}

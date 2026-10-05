import { ApiError, DATABASE_UPGRADE_MESSAGE } from '@/lib/api/errors'

// Only fixed application RPCs and explicitly introduced objects qualify. Never send
// PostgreSQL diagnostics to a browser, or classify arbitrary SQL failures by keywords.
const requiredColumns = new Set(['cash_ends_at', 'cash_enabled', 'cash_event_name', 'tender_mode', 'wallet_amount_won', 'student_card_id'])
const requiredRelations = new Set(['private.sale_tenders', 'private.student_enrollments', 'private.wallet_adjustment_intents'])

// An older database can return valid legacy role sessions while lacking stored
// effective access. Never turn those roles into authority in this application.
export function requireEffectiveAccessResult(rows: unknown, rpc: string): void {
  if (!['create_staff_session', 'authorize_session'].includes(rpc) || !Array.isArray(rows)) return
  if (rows.some(row => row && typeof row === 'object' &&
    (!Object.hasOwn(row, 'preset') || !Object.hasOwn(row, 'access_revision')))) {
    throw new ApiError(503, 'DATABASE_UPGRADE_REQUIRED', DATABASE_UPGRADE_MESSAGE)
  }
}

export function compatibilityError(error: unknown, requiredRpc: string): ApiError | null {
  const seen = new Set<unknown>()
  while (error && typeof error === 'object' && !seen.has(error)) {
    seen.add(error)
    const diagnostic = error as { code?: string; message?: string; cause?: unknown }
    const message = diagnostic.message ?? ''
    const missingFunction = diagnostic.code === '42883' && message.startsWith(`function api.${requiredRpc}(`) && message.endsWith(' does not exist')
    const column = /^column (?:[a-z_]+\.)?"?([a-z_]+)"? does not exist$/.exec(message)?.[1]
    const relation = /^relation "([a-z_.]+)" does not exist$/.exec(message)?.[1]
    if (missingFunction || (diagnostic.code === '42703' && column && requiredColumns.has(column)) ||
      (diagnostic.code === '42P01' && relation && requiredRelations.has(relation)) ||
      (diagnostic.code === '3F000' && message === 'schema "api" does not exist')) {
      return new ApiError(503, 'DATABASE_UPGRADE_REQUIRED', DATABASE_UPGRADE_MESSAGE)
    }
    error = diagnostic.cause
  }
  return null
}

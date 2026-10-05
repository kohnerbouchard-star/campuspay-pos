import { describe, expect, it } from 'vitest'
import { compatibilityError, requireEffectiveAccessResult } from '../compatibility'
import { toApiError, DATABASE_UPGRADE_MESSAGE } from '@/lib/api/errors'
import { failure } from '@/lib/api/response'
describe('known database capability failures', () => {
  const missing = { code: '42883', message: 'function api.terminal_payment_policy_v2(p_session_id => uuid) does not exist' }
  it('maps a missing required RPC to a safe 503', () => { expect(compatibilityError(missing, 'terminal_payment_policy_v2')).toMatchObject({ status: 503, code: 'DATABASE_UPGRADE_REQUIRED', message: DATABASE_UPGRADE_MESSAGE }) })
  it('finds wrapped pg diagnostics without leaking the SQL wrapper', async () => { const error = compatibilityError(new Error('SELECT secrets FROM private.table', { cause: missing }), 'terminal_payment_policy_v2')!; const payload = await failure(error).json(); expect(payload.error).toEqual({ code: 'DATABASE_UPGRADE_REQUIRED', message: DATABASE_UPGRADE_MESSAGE }) })
  it.each([{ code: '42703', message: 'column t.cash_ends_at does not exist' }, { code: '42P01', message: 'relation "private.sale_tenders" does not exist' }, { code: '3F000', message: 'schema "api" does not exist' }])('recognizes known missing objects: $code', error => { expect(compatibilityError(error, 'terminal_payment_policy_v2')?.status).toBe(503) })
  it.each([{ code: '42883', message: 'function api.unrelated(uuid) does not exist' }, { code: '42703', message: 'column unexpected_typo does not exist' }, { code: '42P01', message: 'relation "private.unrelated" does not exist' }, { code: '42501', message: 'permission denied for function api.terminal_payment_policy_v2' }, { code: 'XX000', message: 'function api.terminal_payment_policy_v2(uuid) does not exist' }])('does not misclassify unrelated failures: $code $message', error => { expect(compatibilityError(error, 'terminal_payment_policy_v2')).toBeNull() })
  it('keeps normal internal failures generic', () => { expect(toApiError(new Error('private data unreachable'))).toMatchObject({ status: 500, code: 'INTERNAL_ERROR', message: 'The operation could not be completed' }) })
  it('handles circular diagnostic causes', () => { const error: { cause?: unknown } = {}; error.cause = error; expect(compatibilityError(error, 'catalog')).toBeNull() })
  it.each(['create_staff_session','authorize_session'])('refuses legacy role authority from %s until stored access is installed', rpc => {
    expect(() => requireEffectiveAccessResult([{ role: 'super_admin', permissions: ['security.staff.manage'] }], rpc)).toThrow(DATABASE_UPGRADE_MESSAGE)
    try { requireEffectiveAccessResult([{ role:'cashier',permissions:['pos.checkout'] }],rpc) } catch(error) { expect(error).toMatchObject({status:503,code:'DATABASE_UPGRADE_REQUIRED'}) }
  })
  it('permits empty authentication results and current effective-access responses', () => {
    expect(() => requireEffectiveAccessResult([],'create_staff_session')).not.toThrow()
    expect(() => requireEffectiveAccessResult([{preset:'staff',access_revision:2,permissions:['pos.read']}],'authorize_session')).not.toThrow()
    expect(() => requireEffectiveAccessResult([{name:'Bottled Water'}],'catalog')).not.toThrow()
  })
})

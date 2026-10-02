import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('server-only', () => ({}))
vi.mock('@/lib/db/rpc', () => ({ callApiRpc: mocks.rpc }))
vi.mock('@/lib/env/server', () => ({ getServerEnv: () => ({ SESSION_HMAC_SECRET: 'fixture-not-an-operator-secret' }) }))
vi.mock('@/lib/crypto/hmac', () => ({ hmacHex: () => 'fixture-elevation-hash' }))
vi.mock('@/lib/crypto/staff-pin', () => ({ staffPinProof: () => 'fixture-staff-pin-proof' }))
vi.mock('@/lib/crypto/student-pin', () => ({ studentPinProof: () => 'fixture-student-pin-proof' }))
vi.mock('@/lib/crypto/card-fingerprint', () => ({ fingerprintCard: () => 'fixture-card-fingerprint' }))

import { createStepUp } from '@/features/security/server'
import { ApiError } from '@/lib/api/errors'
import type { SessionContext } from '@/features/auth/domain'

const session = { session_id: '10000000-0000-4000-8000-000000000001' } as SessionContext
const input = { superAdminEmployeeCode: 'TEST-ADMIN', superAdminPin: '1234', purpose: 'RESET_STUDENT_PIN', studentId: '10000000-0000-4000-8000-000000000002' }
beforeEach(() => vi.resetAllMocks())

describe('approval denial is distinct from requesting staff session failure', () => {
  it('maps zero approval rows to INVALID_PIN without exposing account existence or lock state', async () => {
    mocks.rpc.mockImplementation(async (_name, _params, schema) => schema.parse([]))
    await expect(createStepUp(session, input)).rejects.toMatchObject({ status: 401, code: 'INVALID_PIN', message: 'Super-admin authentication failed or is temporarily locked' })
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
  })
  it('preserves an actual expired requesting-staff session', async () => {
    mocks.rpc.mockRejectedValue(new ApiError(401, 'SESSION_EXPIRED', 'Session expired'))
    await expect(createStepUp(session, input)).rejects.toMatchObject({ status: 401, code: 'SESSION_EXPIRED' })
  })
  it('binds valid approval to the original session, student and action, never a readable PIN', async () => {
    mocks.rpc.mockImplementation(async (_name, _params, schema) => schema.parse([{ expires_at: '2026-10-02T02:01:00Z' }]))
    const result = await createStepUp(session, input)
    expect(result.authorizationToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(mocks.rpc.mock.calls[0][0]).toBe('create_elevation')
    expect(mocks.rpc.mock.calls[0][1]).toEqual({
      p_session_id: session.session_id,
      p_approver_employee_code: input.superAdminEmployeeCode,
      p_approver_pin_proof: 'fixture-staff-pin-proof',
      p_purpose: input.purpose,
      p_student_id: input.studentId,
      p_token_hash: 'fixture-elevation-hash',
    })
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(input.superAdminPin)
    expect(JSON.stringify(mocks.rpc.mock.calls[0][1])).not.toContain(result.authorizationToken)
  })
  it('rejects duplicate or malformed approval rows', async () => {
    for (const rows of [[{}, {}], [{}], [{ expires_at: null }]]) {
      mocks.rpc.mockImplementation(async (_name, _params, schema) => schema.parse(rows))
      await expect(createStepUp(session, input)).rejects.toThrow()
    }
  })
})

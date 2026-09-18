import { randomInt, randomUUID } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { CompleteEnrollmentSchema, CompletionDecisionSchema, RecoverCompletionSchema, completionEnabled } from '@/features/students/completion-domain'
import { clearPendingCompletion, readPendingCompletion, savePendingCompletion } from '@/features/students/completion-storage'

const fixturePin = String(randomInt(100000, 1000000))
const input = {
  expectedCode: 'QA-1', expectedName: 'Synthetic Student', expectedYear: 10, expectedAcademicYear: '2026-2027',
  identityVerified: true as const, cardRead: 'SYNTHETICCARD', pin: fixturePin, confirmationPin: fixturePin, idempotencyKey: randomUUID(),
}
function storage() {
  const map = new Map<string,string>()
  return { map, getItem: (key: string) => map.get(key) ?? null, setItem: (key: string,value: string) => { map.set(key,value) }, removeItem: (key: string) => { map.delete(key) } }
}
describe('initial issuance validation', () => {
  it('requires the exact roster identity and matching privately entered PINs', () => expect(CompleteEnrollmentSchema.safeParse(input).success).toBe(true))
  it.each([false,undefined,null])('requires affirmative identity verification (%s)', identityVerified => expect(CompleteEnrollmentSchema.safeParse({ ...input, identityVerified }).success).toBe(false))
  it.each([0,14,2.5])('rejects invalid year %s', expectedYear => expect(CompleteEnrollmentSchema.safeParse({ ...input, expectedYear }).success).toBe(false))
  it('rejects mismatched PINs', () => expect(CompleteEnrollmentSchema.safeParse({ ...input, confirmationPin: `${fixturePin}1` }).success).toBe(false))
  it('rejects card punctuation without sufficient identifier characters', () => expect(CompleteEnrollmentSchema.safeParse({ ...input, cardRead: '::::::' }).success).toBe(false))
  it('rejects missing target metadata and caller-chosen roles', () => {
    expect(CompleteEnrollmentSchema.safeParse({ ...input, expectedCode: undefined }).success).toBe(false)
    expect(CompleteEnrollmentSchema.safeParse({ ...input, role: 'super_admin' }).success).toBe(false)
  })
  it('accepts explicitly unassigned years without inventing one', () => expect(CompleteEnrollmentSchema.safeParse({ ...input, expectedYear: null, expectedAcademicYear: null }).success).toBe(true))
  it('recovery accepts a key and no credential material', () => {
    expect(RecoverCompletionSchema.safeParse({ idempotencyKey: input.idempotencyKey }).success).toBe(true)
    expect(RecoverCompletionSchema.safeParse({ idempotencyKey: input.idempotencyKey, pin: fixturePin }).success).toBe(false)
  })
  it('requires a real receipt for a completed decision', () => expect(CompletionDecisionSchema.safeParse({ outcome:'COMPLETED',student_id:null,audit_reference:null,completed_at:null }).success).toBe(false))
  it('does not expose identity or receipt fields on rejected requests', () => expect(CompletionDecisionSchema.safeParse({ outcome:'IDEMPOTENCY_CONFLICT',student_id:randomUUID(),audit_reference:null,completed_at:null }).success).toBe(false))
  it.each([undefined,'false','TRUE','1','true '])('issuance stays disabled for %s', value => expect(completionEnabled(value)).toBe(false))
  it('enables issuance only through an explicit true setting', () => expect(completionEnabled('true')).toBe(true))
})
describe('credential-free recovery storage', () => {
  it('persists only one request UUID under the student UUID', () => {
    const store=storage(),studentId=randomUUID()
    savePendingCompletion(store,studentId,input.idempotencyKey)
    expect(readPendingCompletion(store,studentId)).toBe(input.idempotencyKey)
    expect([...store.map.values()]).toEqual([input.idempotencyKey])
    expect(JSON.stringify([...store.map])).not.toContain(fixturePin)
    expect(JSON.stringify([...store.map])).not.toContain(input.expectedName)
  })
  it('does not confuse students with duplicate names', () => {
    const store=storage(),a=randomUUID(),b=randomUUID()
    savePendingCompletion(store,a,input.idempotencyKey)
    expect(readPendingCompletion(store,b)).toBeNull()
    clearPendingCompletion(store,a)
    expect(readPendingCompletion(store,a)).toBeNull()
  })
  it('rejects invalid IDs before writing', () => {
    const store=storage()
    expect(() => savePendingCompletion(store,'not-a-student',input.idempotencyKey)).toThrow()
    expect(() => savePendingCompletion(store,randomUUID(),'not-a-key')).toThrow()
    expect(store.map.size).toBe(0)
  })
  it('scrubs malformed references rather than replaying arbitrary contents', () => {
    const store=storage(),id=randomUUID()
    store.setItem(`campuspay:roster-completion:v1:${id}`,'malformed')
    expect(readPendingCompletion(store,id)).toBeNull()
    expect(store.map.size).toBe(0)
  })
  it('fails closed when storage silently refuses a write', () => {
    expect(() => savePendingCompletion({ getItem: () => null,setItem: () => {},removeItem: () => {} },randomUUID(),randomUUID())).toThrow('unavailable')
  })
})

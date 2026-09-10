import { describe, expect, it } from 'vitest'
import { EnrollmentSchema } from '@/features/students/domain'

const valid = {
  studentCode: 'STU-1042', displayName: 'Enrollment test student', cardRead: 'ENROLLMENT-CARD',
  pin: '123456', confirmationPin: '123456', idempotencyKey: '829870eb-3f73-43f8-bbe0-c740601435df',
}

describe('student enrollment input', () => {
  it('accepts the current student model and matching private PIN entries', () => {
    expect(EnrollmentSchema.parse({ ...valid, studentCode: ' STU-1042 ', displayName: ' Enrollment test student ' })).toMatchObject({ studentCode: valid.studentCode, displayName: valid.displayName })
  })
  it.each([
    { studentCode: '' }, { displayName: '' }, { displayName: 'Test\nName' },
    { pin: '123', confirmationPin: '123' }, { pin: '1234567890123', confirmationPin: '1234567890123' },
    { pin: '12x456' }, { confirmationPin: '654321' }, { confirmationPin: undefined },
    { cardRead: '------' }, { cardRead: '' }, { cardRead: 'A'.repeat(65) },
    { initialBalanceWon: 1000 }, { role: 'super_admin' }, { idempotencyKey: 'invalid' },
  ])('rejects malformed or unauthorized enrollment fields: %o', (changes) => {
    expect(EnrollmentSchema.safeParse({ ...valid, ...changes }).success).toBe(false)
  })
})

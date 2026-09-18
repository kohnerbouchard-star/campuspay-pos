import { describe, expect, it } from 'vitest'
import { ManagedStudentSchema, RosterQuerySchema, RosterStudentSchema } from '@/features/students/domain'

const student = {
  student_id: '60000000-0000-4000-8000-000000000001', student_code: 'ROSTER-1', display_name: 'Repeated Fixture',
  active: true, balance_won: 0, card_active: false, pin_locked_until: null,
  created_at: '2026-09-18T01:00:00Z', audit_reference: null,
  year_group: 10, academic_year: '2026-2027', pin_set: false, total_count: 135,
}
describe('student roster metadata', () => {
  it('accepts an unissued roster entry with a zero balance', () => {
    expect(RosterStudentSchema.parse(student).pin_set).toBe(false)
    expect(RosterStudentSchema.parse(student).card_active).toBe(false)
  })
  it('keeps duplicate names distinct through ID and year', () => {
    const second = RosterStudentSchema.parse({ ...student, student_id: '60000000-0000-4000-8000-000000000002', student_code: 'ROSTER-2', year_group: 11 })
    expect(second.display_name).toBe(student.display_name)
    expect(second.student_code).not.toBe(student.student_code)
    expect(second.year_group).not.toBe(student.year_group)
  })
  it('supports explicitly unassigned year data without guessing', () => {
    expect(RosterStudentSchema.parse({ ...student, year_group: null, academic_year: null }).year_group).toBeNull()
  })
  it('requires credential-state metadata on the new endpoint', () => {
    expect(RosterStudentSchema.safeParse({ ...student, pin_set: undefined }).success).toBe(false)
  })
  it('retains the legacy managed-student response shape', () => {
    const legacy = { ...student, year_group: undefined, academic_year: undefined, pin_set: undefined, total_count: undefined }
    expect(ManagedStudentSchema.safeParse(legacy).success).toBe(true)
  })
  it.each([0, 14, -1, 6.5])('rejects invalid year %s', year => {
    expect(RosterQuerySchema.safeParse({ query: '', yearGroup: year, offset: 0 }).success).toBe(false)
  })
  it.each([-1, 0.5, 1000001, Number.NaN])('rejects invalid offset %s', offset => {
    expect(RosterQuerySchema.safeParse({ query: '', yearGroup: null, offset }).success).toBe(false)
  })
  it('accepts bounded paging and trims the search', () => {
    expect(RosterQuerySchema.parse({ query: ' Fixture ', yearGroup: 10, offset: 50 })).toEqual({ query: 'Fixture', yearGroup: 10, offset: 50 })
  })
  it('rejects oversized search and unexpected parameters', () => {
    expect(RosterQuerySchema.safeParse({ query: 'x'.repeat(121), yearGroup: null, offset: 0 }).success).toBe(false)
    expect(RosterQuerySchema.safeParse({ query: '', yearGroup: null, offset: 0, studentPin: '1234' }).success).toBe(false)
  })
})

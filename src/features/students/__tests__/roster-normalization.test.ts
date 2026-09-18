import { describe, expect, it } from 'vitest'
import { normalizeDatabaseValue } from '@/lib/db/normalize'
import { RosterStudentSchema } from '@/features/students/domain'

const databaseRow = {
  student_id: '60000000-0000-4000-8000-000000000001',
  student_code: 'MICA-000001', display_name: 'Synthetic Roster Fixture', active: true,
  balance_won: '0', card_active: false, pin_locked_until: null,
  created_at: new Date('2026-09-18T01:00:00Z'), audit_reference: null,
  year_group: 10, academic_year: '2026-2027', pin_set: false, total_count: '135',
}

describe('roster PostgreSQL response normalization', () => {
  it('converts COUNT bigint text before validating the API response', () => {
    const [student] = RosterStudentSchema.array().parse(normalizeDatabaseValue([databaseRow]))
    expect(student.total_count).toBe(135)
    expect(student.balance_won).toBe(0)
    expect(student.pin_set).toBe(false)
    expect(student.created_at).toBe('2026-09-18T01:00:00.000Z')
  })
  it('normalizes string Year values while preserving stable ID leading zeros', () => {
    const student = RosterStudentSchema.parse(normalizeDatabaseValue({ ...databaseRow, year_group: '10' }))
    expect(student.year_group).toBe(10)
    expect(student.student_code).toBe('MICA-000001')
    expect(student.academic_year).toBe('2026-2027')
  })
  it('preserves an unassigned year and rejects unsafe totals', () => {
    const student = RosterStudentSchema.parse(normalizeDatabaseValue({ ...databaseRow, year_group: null }))
    expect(student.year_group).toBeNull()
    expect(() => normalizeDatabaseValue({ ...databaseRow, total_count: '9007199254740993' })).toThrow('safe range')
  })
})

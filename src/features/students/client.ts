import { apiFetch } from '@/lib/api/client'
import type { EnrollmentInput, EnrollmentResult, ManagedStudent } from '@/features/students/domain'

export function getStudents(query: string) {
  return apiFetch<ManagedStudent[]>(`/api/students?q=${encodeURIComponent(query)}`)
}

export function getRosterStudents(query: string, yearGroup: number | null = null, offset = 0) {
  const parameters = new URLSearchParams({ q: query, offset: String(offset) })
  if (yearGroup !== null) parameters.set('year', String(yearGroup))
  return apiFetch<ManagedStudent[]>(`/api/students/roster?${parameters.toString()}`)
}

export function postEnrollment(input: EnrollmentInput) {
  return apiFetch<EnrollmentResult>('/api/students', { method: 'POST', body: JSON.stringify(input) })
}

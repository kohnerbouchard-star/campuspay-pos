import { apiFetch } from '@/lib/api/client'
import type { EnrollmentInput, EnrollmentResult, ManagedStudent } from '@/features/students/domain'

export function getStudents(query: string) {
  return apiFetch<ManagedStudent[]>(`/api/students?q=${encodeURIComponent(query)}`)
}

export function postEnrollment(input: EnrollmentInput) {
  return apiFetch<EnrollmentResult>('/api/students', { method: 'POST', body: JSON.stringify(input) })
}

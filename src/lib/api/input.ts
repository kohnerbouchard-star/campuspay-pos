import { ApiError } from './errors'

export function parseInput<T>(parser: { safeParse(value: unknown): { success: boolean; data?: T } }, value: unknown): T {
  const result = parser.safeParse(value)
  if (!result.success) throw new ApiError(400, 'BAD_REQUEST', 'Request validation failed')
  return result.data as T
}

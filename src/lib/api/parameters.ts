import { z } from 'zod'
import { ApiError } from './errors'

/** Only use this for untrusted input, never for validating a database response. */
export function parseInput<T>(schema: { safeParse(input: unknown): { success: true; data: T } | { success: false } }, input: unknown): T {
  const parsed = schema.safeParse(input)
  if (!parsed.success) throw new ApiError(400, 'BAD_REQUEST', 'Request parameters are invalid')
  return parsed.data
}

/** All current dynamic API segments identify database UUIDs. */
export async function validateRouteParameters(route: string, context: unknown): Promise<void> {
  const names = [...route.matchAll(/\[([A-Za-z]+Id)\]/g)].map(match => match[1])
  if (!names.length) return
  if (!context || typeof context !== 'object' || !('params' in context)) throw new ApiError(400, 'BAD_REQUEST', 'Missing request parameters')
  const params: unknown = await context.params
  if (!params || typeof params !== 'object') throw new ApiError(400, 'BAD_REQUEST', 'Missing request parameters')
  for (const name of names) parseInput(z.string().uuid(), (params as Record<string, unknown>)[name])
}

export function validateQueryParameters(request: Request): void {
  const query = new URL(request.url).searchParams
  for (const name of ['offset', 'staffOffset', 'terminalOffset']) {
    const values = query.getAll(name)
    if (values.length > 1) throw new ApiError(400, 'BAD_REQUEST', 'Duplicate pagination parameter')
    if (values.length) parseInput(z.string().regex(/^\d+$/).transform(Number).pipe(z.number().int().min(0).max(2147483597)), values[0])
  }
  for (const name of ['from', 'to', 'day']) {
    const values = query.getAll(name)
    if (values.length > 1) throw new ApiError(400, 'BAD_REQUEST', 'Duplicate date parameter')
    if (values.length) parseInput(z.string().date(), values[0])
  }
  if (query.has('refundId')) parseInput(z.string().uuid(), query.get('refundId'))
}

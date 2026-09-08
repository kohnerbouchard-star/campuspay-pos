import { NextResponse } from 'next/server'
import { ApiError, toApiError } from '@/lib/api/errors'
import { recordRequestError } from './request-context'

export type ApiSuccess<T> = { ok: true; data: T }
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } }

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init)
}

export function failure(error: unknown) {
  const normalized = toApiError(error)
  recordRequestError(normalized.code)
  return NextResponse.json<ApiFailure>(
    {
      ok: false,
      error: {
        code: normalized.code,
        message: normalized.message,
        ...(normalized.details === undefined ? {} : { details: normalized.details }),
      },
    },
    { status: normalized.status },
  )
}

export function assertMutationOrigin(request: Request): void {
  const origin = request.headers.get('origin')
  const requestOrigin = new URL(request.url).origin
  const surfaceOrigin = new URL(request.url).pathname.startsWith('/api/store/') ? process.env.STORE_ORIGIN : process.env.STAFF_ORIGIN
  const allowedOrigins = new Set([requestOrigin, surfaceOrigin || process.env.APP_ORIGIN].filter(Boolean))
  // A sibling student/staff origin is still cross-origin. Do not allow a store
  // page to submit mutations using an ambient staff cookie on the staff host.
  if ((origin && !allowedOrigins.has(origin)) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not accepted')
  }
}

export async function parseJson<T>(request: Request, parser: { parse(value: unknown): T }): Promise<T> {
  assertMutationOrigin(request)
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body must be valid JSON')
  }
  try {
    return parser.parse(body)
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request validation failed')
  }
}

import { NextResponse } from 'next/server'
import { ApiError, toApiError } from '@/lib/api/errors'

export type ApiSuccess<T> = { ok: true; data: T }
export type ApiFailure = { ok: false; error: { code: string; message: string; details?: unknown } }

export function ok<T>(data: T, init?: ResponseInit) {
  return NextResponse.json<ApiSuccess<T>>({ ok: true, data }, init)
}

export function failure(error: unknown) {
  const normalized = toApiError(error)
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

export async function parseJson<T>(request: Request, parser: { parse(value: unknown): T }): Promise<T> {
  const origin = request.headers.get('origin')
  if ((origin && origin !== (process.env.APP_ORIGIN || new URL(request.url).origin)) || request.headers.get('sec-fetch-site') === 'cross-site') {
    throw new ApiError(403, 'FORBIDDEN', 'Cross-origin requests are not accepted')
  }
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

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
  let body: unknown
  try {
    body = await request.json()
  } catch {
    throw new ApiError(400, 'BAD_REQUEST', 'Request body must be valid JSON')
  }
  try {
    return parser.parse(body)
  } catch (error) {
    throw new ApiError(400, 'BAD_REQUEST', 'Request validation failed', error)
  }
}

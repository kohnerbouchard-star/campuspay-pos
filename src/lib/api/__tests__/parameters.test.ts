import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { validateRouteParameters, validateQueryParameters, parseInput } from '../parameters'
import { toApiError } from '../errors'
describe('request parameter boundaries', () => {
  it.each(['intentId','studentId','productId','couponId','orderId'])('validates %s before a handler can cast it', async (name) => {
    const route = `/api/example/[${name}]/action`
    await expect(validateRouteParameters(route, { params: Promise.resolve({ [name]: 'invalid' }) })).rejects.toMatchObject({ status: 400 })
    await expect(validateRouteParameters(route, { params: Promise.resolve({ [name]: '01234567-1234-4234-8234-0123456789ab' }) })).resolves.toBeUndefined()
  })
  it.each(['offset=-1','offset=abc','offset=1.5','offset=1&offset=2','staffOffset=Infinity','from=2026-02-30','to=invalid','refundId=nope'])('rejects invalid query %s', (query) => {
    expect(() => validateQueryParameters(new Request(`https://test.invalid/api?${query}`))).toThrow()
  })
  it('keeps database response-schema errors internal while input parsing is a 400', () => {
    expect(() => parseInput(z.number(), 'wrong')).toThrowError(expect.objectContaining({ status: 400 }))
    const parsed = z.number().safeParse('wrong')
    if (!parsed.success) expect(toApiError(parsed.error).status).toBe(500)
  })
  it.each(['22P02','22007','22008'])('maps invalid SQL argument %s without the raw message', (code) => {
    const error = Object.assign(new Error('private SQL and values'), { code })
    expect(toApiError(error)).toMatchObject({ status: 400, code: 'BAD_REQUEST' })
    expect(toApiError(error).message).not.toContain('private SQL')
  })
})

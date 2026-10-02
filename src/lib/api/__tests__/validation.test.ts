import { describe, expect, it } from 'vitest'
import { z } from 'zod'
import { failure, parseJson } from '../response'
import { validationFeedback } from '../validation'
import { ReceiveStockSchema } from '@/features/inventory/domain'
import { UpdatePaymentPolicySchema } from '@/features/pos/domain'
import { EVENT_PAYMENT_MESSAGES } from '@/features/pos/payment-policy-validation'
const request = (value: unknown) => new Request('http://localhost:3000/api/example', { method: 'POST', headers: { origin: 'http://localhost:3000' }, body: JSON.stringify(value) })
const feedback = (schema: z.ZodType, value: unknown) => {
  const parsed = schema.safeParse(value, { reportInput: true })
  if (parsed.success) throw new Error('Expected a validation failure')
  return validationFeedback(schema, parsed.error.issues)
}
describe('safe request validation using real Zod schemas', () => {
  it('reports declared nested receipt fields without disclosing submitted data', () => {
    const result = feedback(ReceiveStockSchema, { supplierName: 'SECRET_SUPPLIER', supplierInvoice: 'SECRET_INVOICE', purchaseDate: 'bad-date', idempotencyKey: 'bad-reference', lines: [{ productId: 'SECRET_ID', quantity: 0, purchaseUnitCostWon: -1 }] })
    expect(result.fieldErrors.map(error => error.field)).toEqual(expect.arrayContaining(['purchaseDate', 'idempotencyKey', 'lines.0.productId', 'lines.0.quantity', 'lines.0.purchaseUnitCostWon']))
    expect(JSON.stringify(result)).not.toMatch(/SECRET|bad-date|bad-reference|input|pattern/)
  })
  it('recognizes optional/defaulted/nullable array paths', () => {
    for (const schema of [z.object({ list: z.array(z.object({ value: z.number().min(1) })) }).optional(), z.object({ list: z.array(z.object({ value: z.number().min(1) })).nullable().default([]) })]) {
      expect(feedback(schema, { list: [{ value: 0 }] }).fieldErrors[0].field).toBe('list.0.value')
    }
  })
  it('recognizes discriminated unions and input-side transformations', () => {
    const schema = z.discriminatedUnion('action', [z.object({ action: z.literal('A'), count: z.number().min(1) }), z.object({ action: z.literal('B'), name: z.string() })])
    expect(feedback(schema, { action: 'A', count: 0 }).fieldErrors[0].field).toBe('count')
    expect(feedback(z.object({ count: z.number().min(1) }).transform(v => v.count), { count: 0 }).fieldErrors[0].field).toBe('count')
  })
  it('never reflects dynamic record keys, unknown properties or custom messages', () => {
    expect(JSON.stringify(feedback(z.record(z.string(), z.number()), { SECRET_DYNAMIC_KEY: 'SECRET_VALUE' }))).not.toContain('SECRET')
    expect(JSON.stringify(feedback(z.object({ known: z.string() }).strict(), { known: 'ok', SECRET_KEY: 'secret' }))).not.toMatch(/SECRET|secret/)
    expect(JSON.stringify(feedback(z.object({ pin: z.string().refine(() => false, 'SECRET_CUSTOM') }), { pin: 'SECRET_PIN' }))).not.toContain('SECRET')
  })
  it('returns BAD_REQUEST/400 plus fieldErrors through the normal API envelope', async () => {
    let caught: unknown
    try { await parseJson(request({ quantity: 0 }), z.object({ quantity: z.number().min(1) })) } catch (error) { caught = error }
    const response = failure(caught)
    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ ok: false, error: { code: 'BAD_REQUEST', message: expect.stringContaining('quantity'), details: { fieldErrors: [{ field: 'quantity', message: 'Enter a number at least 1.' }] } } })
  })
  it('keeps malformed JSON and cross-origin failures separate', async () => {
    await expect(parseJson(new Request('http://localhost:3000/api/example', { method: 'POST', body: '{' }), z.object({}))).rejects.toMatchObject({ status: 400, message: 'Request body must be valid JSON' })
    await expect(parseJson(new Request('http://localhost:3000/api/example', { method: 'POST', headers: { origin: 'https://other.test' }, body: '{}' }), z.object({ quantity: z.number() }))).rejects.toMatchObject({ status: 403, code: 'FORBIDDEN' })
  })
  it('preserves approved policy-specific guidance and does not weaken event rules', async () => {
    const input = { cashEnabled: true, eventName: 'Synthetic event', endsAt: new Date(Date.now() - 3_600_000).toISOString() }
    await expect(parseJson(request(input), UpdatePaymentPolicySchema, { allowedCustomMessages: Object.values(EVENT_PAYMENT_MESSAGES) })).rejects.toMatchObject({ status: 400, code: 'BAD_REQUEST', message: expect.stringContaining('already passed'), details: { fieldErrors: [{ field: 'endsAt', message: EVENT_PAYMENT_MESSAGES.pastEnd }] } })
  })
})

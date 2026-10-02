import { describe, expect, it } from 'vitest'
import { receiptConflict } from '../receipt-conflict'
const violation = { code: '23505', constraint: 'stock_receipts_supplier_name_supplier_invoice_key', message: 'SECRET-SUPPLIER-NAME' }
describe('receipt conflict classification', () => {
  it('uses exact SQLSTATE and constraint metadata, without reflecting supplier details', () => {
    const result = receiptConflict(violation, 'receive_stock')
    expect(result).toMatchObject({ status: 409, code: 'RECEIPT_INVOICE_EXISTS' })
    expect(result?.message).not.toContain('SECRET')
  })
  it('handles wrapped database exceptions', () => expect(receiptConflict(new Error('private SQL', { cause: violation }), 'receive_stock')?.status).toBe(409))
  it.each([
    { code: '23505', constraint: 'stock_receipts_idempotency_key_key' },
    { code: '23505', constraint: 'unrelated' },
    { code: '40001', constraint: violation.constraint },
    new Error('23505 stock_receipts_supplier_name_supplier_invoice_key'),
    new Error('response parsing failed'), null,
  ])('leaves unrelated failures unknown: %s', error => expect(receiptConflict(error, 'receive_stock')).toBeNull())
  it('does not affect other RPCs', () => expect(receiptConflict(violation, 'confirm_payment')).toBeNull())
  it('terminates a cyclic error cause safely', () => { const error: {cause?: unknown} = {}; error.cause=error; expect(receiptConflict(error, 'receive_stock')).toBeNull() })
})

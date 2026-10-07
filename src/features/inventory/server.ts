import 'server-only'
import { InventoryProductSchema } from '@/features/inventory/domain'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import {
  InventoryLotsSchema, MutationResultSchema, ReceiptResultSchema, StockAdjustmentResultSchema, StockAdjustmentRecoverySchema,
  type ReceiveStockSchema, type StockAdjustmentSchema,
} from '@/features/inventory/domain'
import { callApiRpc } from '@/lib/db/rpc'

export function listInventoryLots(session: SessionContext) {
  return callApiRpc('inventory_lots', { p_session_id: session.session_id }, InventoryLotsSchema)
}

export function createProduct(session: SessionContext, input: {
  sku: string; name: string; category: string; sellingPriceWon: number; reorderLevel: number
}) {
  return callApiRpc('create_product', {
    p_session_id: session.session_id,
    p_sku: input.sku,
    p_name: input.name,
    p_category: input.category,
    p_selling_price_won: input.sellingPriceWon,
    p_reorder_level: input.reorderLevel,
  }, z.array(MutationResultSchema).length(1).transform(([row]) => row))
}

export function changeProductPrice(session: SessionContext, productId: string, input: { newPriceWon: number; reason: string }) {
  return callApiRpc('change_product_price', {
    p_session_id: session.session_id,
    p_product_id: productId,
    p_new_price_won: input.newPriceWon,
    p_reason: input.reason,
  }, z.array(MutationResultSchema).length(1).transform(([row]) => row))
}

export function receiveStock(session: SessionContext, input: z.infer<typeof ReceiveStockSchema>) {
  return callApiRpc('receive_stock', {
    p_session_id: session.session_id,
    p_supplier_name: input.supplierName,
    p_supplier_invoice: input.supplierInvoice,
    p_purchase_date: input.purchaseDate,
    p_shipping_won: input.shippingWon,
    p_other_costs_won: input.otherCostsWon,
    p_discount_won: input.discountWon,
    p_notes: input.notes ?? null,
    p_lines: input.lines,
    p_idempotency_key: input.idempotencyKey,
  }, z.array(ReceiptResultSchema).length(1).transform(([row]) => row))
}

export async function removeStock(session: SessionContext, input: z.infer<typeof StockAdjustmentSchema>) {
  const result = await callApiRpc('remove_stock', {
    p_session_id: session.session_id,
    p_product_id: input.productId,
    p_lot_id: input.lotId ?? null,
    p_quantity: input.quantityToRemove,
    p_reason_code: input.reasonCode,
    p_notes: input.notes,
    p_idempotency_key: input.idempotencyKey,
  }, z.array(MutationResultSchema).length(1).transform(([row]) => row))
  // The SQL driver's raw timestamptz text uses a space and +00; publish a
  // canonical ISO timestamp for the strict browser response contract.
  return StockAdjustmentResultSchema.parse({ ...result, created_at: new Date(result.created_at).toISOString(), idempotency_key: input.idempotencyKey })
}

export function recoverStockAdjustment(session: SessionContext, idempotencyKey: string) {
  return callApiRpc('recover_stock_adjustment', { p_session_id: session.session_id, p_idempotency_key: idempotencyKey },
    z.array(z.object({ result: StockAdjustmentRecoverySchema })).length(1).transform(([row]) => row.result))
}

export function inventoryProducts(session: SessionContext) {
  return callApiRpc('inventory_product_register', { p_session_id: session.session_id }, z.array(InventoryProductSchema))
}

export async function recoverStockReceipt(session: SessionContext, idempotencyKey: string) {
  const rows = await callApiRpc('recover_stock_receipt', { p_session_id: session.session_id, p_idempotency_key: idempotencyKey }, z.array(ReceiptResultSchema).max(1))
  return { receipt: rows[0] ?? null }
}

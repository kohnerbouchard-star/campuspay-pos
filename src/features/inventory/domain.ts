import { z } from 'zod'
import { CatalogProductSchema } from '@/features/pos/domain'

export const InventoryProductSchema = CatalogProductSchema.extend({ reorder_level: z.number().int(), low_stock: z.boolean() })
export type InventoryProduct = z.infer<typeof InventoryProductSchema>

export const CostMethodSchema = z.enum(['FIFO', 'LIFO'])
export type CostMethod = z.infer<typeof CostMethodSchema>

export const CreateProductSchema = z.object({
  sku: z.string().trim().min(1).max(40),
  name: z.string().trim().min(1).max(120),
  category: z.string().trim().min(1).max(80),
  sellingPriceWon: z.number().int().min(0).max(10_000_000),
  reorderLevel: z.number().int().min(0).max(1_000_000),
})

export const PriceChangeSchema = z.object({
  newPriceWon: z.number().int().min(0).max(10_000_000),
  reason: z.string().trim().min(3).max(240),
})

export const ReceiptLineSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.number().int().min(1).max(1_000_000),
  purchaseUnitCostWon: z.number().int().min(0).max(10_000_000),
  expirationDate: z.string().date().nullable().optional(),
  supplierLotCode: z.string().trim().max(80).nullable().optional(),
})

export const ReceiveStockSchema = z.object({
  supplierName: z.string().trim().min(1).max(160),
  supplierInvoice: z.string().trim().min(1).max(120),
  purchaseDate: z.string().date(),
  shippingWon: z.number().int().min(0).max(100_000_000).default(0),
  otherCostsWon: z.number().int().min(0).max(100_000_000).default(0),
  discountWon: z.number().int().min(0).max(100_000_000).default(0),
  notes: z.string().trim().max(500).optional(),
  lines: z.array(ReceiptLineSchema).min(1).max(200),
  idempotencyKey: z.string().uuid(),
})

export const StockAdjustmentReasonSchema = z.enum(['DAMAGED', 'EXPIRED', 'SUPPLIER_RETURN', 'STOCK_COUNT_LOSS'])
export const StockAdjustmentSchema = z.object({
  productId: z.string().uuid(),
  lotId: z.string().uuid().optional(),
  quantityToRemove: z.number().int().min(1).max(1_000_000),
  reasonCode: StockAdjustmentReasonSchema,
  notes: z.string().trim().min(3).max(500),
  idempotencyKey: z.string().uuid(),
})

export const InventoryLotSchema = z.object({
  lot_id: z.string().uuid(),
  product_id: z.string().uuid(),
  product_name: z.string(),
  receipt_number: z.string(),
  received_at: z.string(),
  expiration_date: z.string().nullable(),
  quantity_received: z.number().int(),
  quantity_remaining: z.number().int(),
  landed_unit_cost_won: z.number().int(),
  inventory_value_won: z.number().int(),
})
export type InventoryLot = z.infer<typeof InventoryLotSchema>

export const InventoryLotsSchema = z.array(InventoryLotSchema)

export const ReceiptResultSchema = z.object({
  receipt_id: z.string().uuid(),
  receipt_number: z.string(),
  total_quantity: z.number().int().positive(),
  purchase_subtotal_won: z.number().int().nonnegative(),
  total_landed_cost_won: z.number().int().nonnegative(),
  created_at: z.string(),
})

export const MutationResultSchema = z.object({
  reference_id: z.string().uuid(),
  reference_number: z.string(),
  created_at: z.string(),
})

export const StockAdjustmentRecoverySchema = z.discriminatedUnion('state', [
  z.object({ state: z.literal('POSTED'), reference_id: z.string().uuid(), reference_number: z.string(), created_at: z.string(), quantity_removed: z.number().int().positive(), total_cost_won: z.number().int().nonnegative() }),
  z.object({ state: z.literal('CLOSED') }),
])
export type StockAdjustmentRecovery = z.infer<typeof StockAdjustmentRecoverySchema>

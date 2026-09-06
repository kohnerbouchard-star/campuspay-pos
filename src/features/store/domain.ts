import { z } from 'zod'
import { CouponCodeSchema } from '@/features/coupons/domain'
import { CartLineSchema, CatalogProductSchema } from '@/features/pos/domain'

export const CustomerLoginSchema = z.object({
  cardNumber: z.string().trim().min(6).max(128),
  pin: z.string().min(4).max(12).regex(/^\d+$/),
})

export const CustomerSessionSchema = z.object({
  session_id: z.string().uuid(),
  student_id: z.string().uuid(),
  display_name: z.string(),
  balance_won: z.number().int(),
  debt_won: z.number().int().nonnegative(),
  expires_at: z.string(),
})
export type CustomerSession = z.infer<typeof CustomerSessionSchema>

export const StoreCatalogSchema = z.array(CatalogProductSchema)

export const DeliveryLocationSchema = z.object({
  location_id: z.string().uuid(),
  building: z.enum(['East Building', 'West Building']),
  floor: z.number().int(),
  room: z.string().nullable(),
  orderable: z.boolean(),
})
export type DeliveryLocation = z.infer<typeof DeliveryLocationSchema>
export const DeliveryLocationsSchema = z.array(DeliveryLocationSchema)

export const PlaceOnlineOrderSchema = z.object({
  items: z.array(CartLineSchema).min(1).max(50),
  couponCode: CouponCodeSchema.nullable().optional(),
  deliveryLocationId: z.string().uuid(),
  deliveryNote: z.string().trim().max(240).nullable().optional(),
  idempotencyKey: z.string().uuid(),
})

export const OnlineOrderReceiptSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  status: z.string(),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  balance_before_won: z.number().int(),
  balance_after_won: z.number().int(),
  debt_after_won: z.number().int().nonnegative(),
  coupon_name: z.string().nullable(),
  coupon_code_masked: z.string().nullable(),
  delivery_building: z.string(),
  delivery_floor: z.number().int(),
  delivery_room: z.string(),
  created_at: z.string(),
})
export type OnlineOrderReceipt = z.infer<typeof OnlineOrderReceiptSchema>

export const OnlineOrderItemSchema = z.object({
  product_id: z.string().uuid(),
  name: z.string(),
  quantity: z.number().int().positive(),
  unit_price_won: z.number().int().nonnegative(),
  line_total_won: z.number().int().nonnegative(),
})

export const CustomerOrderSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  status: z.string(),
  subtotal_won: z.number().int().positive(),
  discount_won: z.number().int().nonnegative(),
  total_won: z.number().int().nonnegative(),
  balance_after_won: z.number().int(),
  delivery_building: z.string(),
  delivery_floor: z.number().int(),
  delivery_room: z.string(),
  delivery_note: z.string().nullable(),
  items: z.array(OnlineOrderItemSchema),
  created_at: z.string(),
  delivered_at: z.string().nullable(),
})
export type CustomerOrder = z.infer<typeof CustomerOrderSchema>
export const CustomerOrdersSchema = z.array(CustomerOrderSchema)

export const StaffOnlineOrderSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  status: z.string(),
  student_name: z.string(),
  total_won: z.number().int().nonnegative(),
  delivery_building: z.string(),
  delivery_floor: z.number().int(),
  delivery_room: z.string(),
  delivery_note: z.string().nullable(),
  items: z.array(OnlineOrderItemSchema),
  created_at: z.string(),
})
export type StaffOnlineOrder = z.infer<typeof StaffOnlineOrderSchema>
export const StaffOnlineOrdersSchema = z.array(StaffOnlineOrderSchema)

export const UpdateOrderStatusSchema = z.object({
  status: z.enum(['PICKING', 'READY', 'OUT_FOR_DELIVERY', 'DELIVERED']),
})

export const UpdatedOrderSchema = z.object({
  order_id: z.string().uuid(),
  order_number: z.string(),
  status: z.string(),
  updated_at: z.string(),
})

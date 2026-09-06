import 'server-only'
import { z } from 'zod'
import type { SessionContext } from '@/features/auth/domain'
import { fingerprintCouponCode } from '@/lib/crypto/coupon-code'
import { callApiRpc } from '@/lib/db/rpc'
import type { CustomerSession } from '@/features/store/domain'
import {
  CustomerOrdersSchema, DeliveryLocationsSchema, OnlineOrderReceiptSchema,
  StaffOnlineOrdersSchema, StoreCatalogSchema, UpdatedOrderSchema,
} from '@/features/store/domain'

export function storeCatalog() {
  return callApiRpc('store_catalog', {}, StoreCatalogSchema)
}

export function deliveryLocations() {
  return callApiRpc('store_delivery_locations', {}, DeliveryLocationsSchema)
}

export async function createOnlineOrder(session: CustomerSession, input: {
  items: { productId: string; quantity: number }[]
  couponCode?: string | null
  deliveryLocationId: string
  deliveryNote?: string | null
  idempotencyKey: string
}) {
  const rows = await callApiRpc('create_online_order', {
    p_customer_session_id: session.session_id,
    p_items: input.items,
    p_coupon_code_fingerprint: input.couponCode ? fingerprintCouponCode(input.couponCode) : null,
    p_delivery_location_id: input.deliveryLocationId,
    p_delivery_note: input.deliveryNote ?? null,
    p_idempotency_key: input.idempotencyKey,
  }, z.array(OnlineOrderReceiptSchema).max(1))
  return rows[0]
}

export function customerOrders(session: CustomerSession) {
  return callApiRpc('customer_orders', { p_customer_session_id: session.session_id }, CustomerOrdersSchema)
}

export function staffOnlineOrders(session: SessionContext) {
  return callApiRpc('staff_online_orders', { p_session_id: session.session_id }, StaffOnlineOrdersSchema)
}

export async function updateOnlineOrderStatus(session: SessionContext, orderId: string, status: string) {
  const rows = await callApiRpc('update_online_order_status', {
    p_session_id: session.session_id,
    p_order_id: orderId,
    p_next_status: status,
  }, z.array(UpdatedOrderSchema).max(1))
  return rows[0]
}

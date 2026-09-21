import 'server-only'
import type { ZodType } from 'zod'
import { sql } from 'drizzle-orm'
import { database } from '@/lib/db/client'
import { normalizeDatabaseValue } from '@/lib/db/normalize'
import { toApiError } from '@/lib/api/errors'
import { compatibilityError } from '@/lib/db/compatibility'

type RpcArgument = { readonly name: string; readonly cast: string }

const RPCS = {
  student_wallet_history_page: [{name:'p_session_id',cast:'uuid'},{name:'p_student_id',cast:'uuid'},{name:'p_from',cast:'date'},{name:'p_to',cast:'date'},{name:'p_query',cast:'text'},{name:'p_offset',cast:'integer'},{name:'p_export',cast:'boolean'}],
  cash_history_page: [{name:'p_session_id',cast:'uuid'},{name:'p_from',cast:'date'},{name:'p_to',cast:'date'},{name:'p_query',cast:'text'},{name:'p_offset',cast:'integer'},{name:'p_export',cast:'boolean'}],
  prepare_funding: [{name:'p_session_id',cast:'uuid'},{name:'p_key',cast:'uuid'},{name:'p_action',cast:'text'},{name:'p_payload',cast:'jsonb'}],
  scan_funding_card: [{name:'p_session_id',cast:'uuid'},{name:'p_key',cast:'uuid'},{name:'p_card_fingerprint',cast:'text'}],
  confirm_funding: [{name:'p_session_id',cast:'uuid'},{name:'p_key',cast:'uuid'},{name:'p_student_pin_proof',cast:'text'},{name:'p_approver_code',cast:'text'},{name:'p_approver_proof',cast:'text'},{name:'p_verified',cast:'boolean'}],
  recover_funding: [{name:'p_session_id',cast:'uuid'},{name:'p_key',cast:'uuid'}],
  funding_history: [{name:'p_session_id',cast:'uuid'},{name:'p_from',cast:'date'},{name:'p_to',cast:'date'},{name:'p_offset',cast:'integer'}],
  export_funding: [{name:'p_session_id',cast:'uuid'},{name:'p_from',cast:'date'},{name:'p_to',cast:'date'}],
  partial_refund_snapshot: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_reference', cast: 'text' }, { name: 'p_offset', cast: 'integer' }],
  quote_partial_refund: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sale_id', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }],
  post_partial_refund: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sale_id', cast: 'uuid' }, { name: 'p_key', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_expected_count', cast: 'integer' }, { name: 'p_reason_code', cast: 'text' }, { name: 'p_notes', cast: 'text' }, { name: 'p_verified', cast: 'boolean' }, { name: 'p_return_reason', cast: 'text' }],
  refund_record: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_refund_id', cast: 'uuid' }],
  customer_order_refunds: [{ name: 'p_customer_session_id', cast: 'uuid' }, { name: 'p_order_id', cast: 'uuid' }, { name: 'p_offset', cast: 'integer' }],
  preview_partial_refund: [{name:'p_session_id',cast:'uuid'},{name:'p_sale_id',cast:'uuid'},{name:'p_items',cast:'jsonb'}],
  administration_snapshot: [{name:'p_session_id',cast:'uuid'},{name:'p_staff_offset',cast:'integer'},{name:'p_terminal_offset',cast:'integer'}],
  change_administration: [{name:'p_session_id',cast:'uuid'},{name:'p_key',cast:'uuid'},{name:'p_action',cast:'text'},{name:'p_target_id',cast:'uuid'},{name:'p_payload',cast:'jsonb'},{name:'p_admin_pin_proof',cast:'text'},{name:'p_notes',cast:'text'}],
  recover_administration: [{name:'p_session_id',cast:'uuid'},{name:'p_key',cast:'uuid'}],
  cash_register_snapshot: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_offset', cast: 'integer' }],
  open_cash_shift: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_key', cast: 'uuid' }, { name: 'p_counts', cast: 'jsonb' }, { name: 'p_verified', cast: 'boolean' }],
  close_cash_shift: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_shift_id', cast: 'uuid' }, { name: 'p_key', cast: 'uuid' }, { name: 'p_counts', cast: 'jsonb' }, { name: 'p_notes', cast: 'text' }, { name: 'p_verified', cast: 'boolean' }],
  recover_cash_operation: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_key', cast: 'uuid' }, { name: 'p_operation', cast: 'text' }, { name: 'p_shift_id', cast: 'uuid' }],
  approve_cash_variance: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_shift_id', cast: 'uuid' }, { name: 'p_notes', cast: 'text' }],
  refund_sale_detail: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_reference', cast: 'text' }],
  post_online_return: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sale_id', cast: 'uuid' }, { name: 'p_reason_code', cast: 'text' }, { name: 'p_notes', cast: 'text' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_verified', cast: 'boolean' }, { name: 'p_idempotency_key', cast: 'uuid' }, { name: 'p_return_reason', cast: 'text' }],
  post_sale_refund: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sale_id', cast: 'uuid' }, { name: 'p_reason_code', cast: 'text' }, { name: 'p_notes', cast: 'text' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_verified', cast: 'boolean' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  recover_sale_refund: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sale_id', cast: 'uuid' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  record_refund_cash_payout: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_refund_id', cast: 'uuid' }, { name: 'p_idempotency_key', cast: 'uuid' }, { name: 'p_amount_won', cast: 'bigint' }, { name: 'p_handover_reference', cast: 'text' }, { name: 'p_confirmed', cast: 'boolean' }],
  refund_day_summary: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_from', cast: 'date' }, { name: 'p_to', cast: 'date' }],
  complete_student_enrollment: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_student_id', cast: 'uuid' }, { name: 'p_expected_code', cast: 'text' }, { name: 'p_expected_name', cast: 'text' }, { name: 'p_expected_year', cast: 'integer' }, { name: 'p_expected_academic_year', cast: 'text' }, { name: 'p_identity_verified', cast: 'boolean' }, { name: 'p_card_fingerprint', cast: 'text' }, { name: 'p_pin_proof', cast: 'text' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  recover_student_completion: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_student_id', cast: 'uuid' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  search_students_v2: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_query', cast: 'text' }, { name: 'p_year_group', cast: 'integer' }, { name: 'p_offset', cast: 'integer' }],
  create_staff_session: [{ name: 'p_employee_code', cast: 'text' }, { name: 'p_pin_proof', cast: 'text' }, { name: 'p_session_token_hash', cast: 'text' }, { name: 'p_terminal_fingerprint', cast: 'text' }],
  authorize_session: [{ name: 'p_session_token_hash', cast: 'text' }, { name: 'p_terminal_fingerprint', cast: 'text' }, { name: 'p_permission', cast: 'text' }],
  revoke_staff_session: [{ name: 'p_session_token_hash', cast: 'text' }, { name: 'p_terminal_fingerprint', cast: 'text' }],
  catalog: [{ name: 'p_session_id', cast: 'uuid' }],
  create_payment_intent: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_idempotency_key', cast: 'uuid' }, { name: 'p_coupon_code_fingerprint', cast: 'text' }, { name: 'p_tender_mode', cast: 'text' }, { name: 'p_wallet_amount_won', cast: 'bigint' }],
  finalize_payment_tender: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_wallet_amount_won', cast: 'bigint' }],
  scan_payment_card: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_card_fingerprint', cast: 'text' }],
  confirm_payment: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_student_pin_proof', cast: 'text' }, { name: 'p_cash_received_won', cast: 'bigint' }],
  cancel_payment_intent: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }],
  terminal_payment_policy: [{ name: 'p_session_id', cast: 'uuid' }],
  set_terminal_payment_policy: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_cash_enabled', cast: 'boolean' }, { name: 'p_event_name', cast: 'text' }, { name: 'p_ends_at', cast: 'timestamptz' }],
  create_product: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sku', cast: 'text' }, { name: 'p_name', cast: 'text' }, { name: 'p_category', cast: 'text' }, { name: 'p_selling_price_won', cast: 'bigint' }, { name: 'p_reorder_level', cast: 'integer' }],
  change_product_price: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_product_id', cast: 'uuid' }, { name: 'p_new_price_won', cast: 'bigint' }, { name: 'p_reason', cast: 'text' }],
  inventory_lots: [{ name: 'p_session_id', cast: 'uuid' }],
  receive_stock: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_supplier_name', cast: 'text' }, { name: 'p_supplier_invoice', cast: 'text' }, { name: 'p_purchase_date', cast: 'date' }, { name: 'p_shipping_won', cast: 'bigint' }, { name: 'p_other_costs_won', cast: 'bigint' }, { name: 'p_discount_won', cast: 'bigint' }, { name: 'p_notes', cast: 'text' }, { name: 'p_lines', cast: 'jsonb' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  remove_stock: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_product_id', cast: 'uuid' }, { name: 'p_lot_id', cast: 'uuid' }, { name: 'p_quantity', cast: 'integer' }, { name: 'p_reason_code', cast: 'text' }, { name: 'p_notes', cast: 'text' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  recover_wallet_adjustment: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }],
  recover_stock_receipt: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  inventory_product_register: [{ name: 'p_session_id', cast: 'uuid' }],
  recover_payment_intent: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }],
  student_wallet_history: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_student_id', cast: 'uuid' }],
  search_students: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_query', cast: 'text' }],
  search_security_students: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_query', cast: 'text' }],
  enroll_student: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_student_code', cast: 'text' }, { name: 'p_display_name', cast: 'text' }, { name: 'p_card_fingerprint', cast: 'text' }, { name: 'p_pin_proof', cast: 'text' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  search_student_wallets: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_query', cast: 'text' }],
  create_wallet_adjustment_intent: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_direction', cast: 'text' }, { name: 'p_denominations', cast: 'integer[]' }, { name: 'p_reason_code', cast: 'text' }, { name: 'p_notes', cast: 'text' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  scan_wallet_adjustment_card: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_card_fingerprint', cast: 'text' }],
  confirm_wallet_adjustment: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_student_pin_proof', cast: 'text' }],
  create_elevation: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_approver_employee_code', cast: 'text' }, { name: 'p_approver_pin_proof', cast: 'text' }, { name: 'p_purpose', cast: 'text' }, { name: 'p_student_id', cast: 'uuid' }, { name: 'p_token_hash', cast: 'text' }],
  reset_student_pin: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_student_id', cast: 'uuid' }, { name: 'p_elevation_token_hash', cast: 'text' }, { name: 'p_new_pin_proof', cast: 'text' }],
  reset_student_card: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_student_id', cast: 'uuid' }, { name: 'p_elevation_token_hash', cast: 'text' }, { name: 'p_new_card_fingerprint', cast: 'text' }],
  report_sales: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_from', cast: 'date' }, { name: 'p_to', cast: 'date' }],
  report_inventory: [{ name: 'p_session_id', cast: 'uuid' }],
  report_wallets: [{ name: 'p_session_id', cast: 'uuid' }],
  create_coupon: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_name', cast: 'text' }, { name: 'p_code_fingerprint', cast: 'text' }, { name: 'p_code_masked', cast: 'text' }, { name: 'p_discount_type', cast: 'text' }, { name: 'p_fixed_amount_won', cast: 'bigint' }, { name: 'p_percentage_bps', cast: 'integer' }, { name: 'p_minimum_subtotal_won', cast: 'bigint' }, { name: 'p_max_discount_won', cast: 'bigint' }, { name: 'p_total_redemption_limit', cast: 'integer' }, { name: 'p_per_student_limit', cast: 'integer' }, { name: 'p_starts_at', cast: 'timestamptz' }, { name: 'p_ends_at', cast: 'timestamptz' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  list_coupons: [{ name: 'p_session_id', cast: 'uuid' }],
  deactivate_coupon: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_coupon_id', cast: 'uuid' }, { name: 'p_reason', cast: 'text' }],
  quote_coupon: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_coupon_code_fingerprint', cast: 'text' }],
  report_coupons: [{ name: 'p_session_id', cast: 'uuid' }],
  create_customer_session: [{ name: 'p_card_fingerprint', cast: 'text' }, { name: 'p_pin_proof', cast: 'text' }, { name: 'p_session_token_hash', cast: 'text' }, { name: 'p_ip_fingerprint', cast: 'text' }],
  authorize_customer_session: [{ name: 'p_session_token_hash', cast: 'text' }],
  revoke_customer_session: [{ name: 'p_session_token_hash', cast: 'text' }],
  store_catalog: [{ name: 'p_customer_session_id', cast: 'uuid' }],
  store_delivery_locations: [{ name: 'p_customer_session_id', cast: 'uuid' }],
  quote_online_order: [{ name: 'p_customer_session_id', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_coupon_code_fingerprint', cast: 'text' }],
  create_online_order: [{ name: 'p_customer_session_id', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_coupon_code_fingerprint', cast: 'text' }, { name: 'p_delivery_location_id', cast: 'uuid' }, { name: 'p_delivery_note', cast: 'text' }, { name: 'p_idempotency_key', cast: 'uuid' }, { name: 'p_expected_total_won', cast: 'bigint' }],
  customer_orders: [{ name: 'p_customer_session_id', cast: 'uuid' }],
  recover_online_order: [{ name: 'p_customer_session_id', cast: 'uuid' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  staff_online_orders: [{ name: 'p_session_id', cast: 'uuid' }],
  update_online_order_status: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_order_id', cast: 'uuid' }, { name: 'p_next_status', cast: 'text' }],
} as const satisfies Record<string, readonly RpcArgument[]>

export type ApiRpcName = keyof typeof RPCS

function databaseFunction(name: ApiRpcName) {
  return name === 'terminal_payment_policy' ? 'terminal_payment_policy_v2' : name === 'search_student_wallets' ? 'search_student_wallets_v2' : name === 'list_coupons' ? 'list_coupons_v2' : name
}

function encodeValue(value: unknown, cast: string): unknown {
  if (cast === 'jsonb' && value !== null) return JSON.stringify(value)
  return value
}

function statementFor(name: ApiRpcName, args: Record<string, unknown>) {
  if (!Object.hasOwn(RPCS, name)) throw new Error('BAD_REQUEST')
  const spec = RPCS[name]
  if (Object.keys(args).some((key) => !spec.some((item) => item.name === key))) {
    throw new Error('BAD_REQUEST')
  }
  const parameters = spec.map((argument) => sql`${sql.raw(argument.name)} => ${sql.param(encodeValue(args[argument.name] ?? null, argument.cast))}::${sql.raw(argument.cast)}`)
  // Identifiers come only from RPCS, never from a request. Values are parameters.
  const functionName = databaseFunction(name)
  return sql`select * from api.${sql.raw(functionName)}(${sql.join(parameters, sql`, `)})`
}

export async function callApiRpc<T>(
  name: ApiRpcName,
  args: Record<string, unknown>,
  schema: ZodType<T>,
): Promise<T> {
  try {
    const spec = RPCS[name]
    const unknown = Object.keys(args).filter((key) => !spec.some((item) => item.name === key))
    if (unknown.length > 0) throw new Error(`Unexpected RPC arguments: ${unknown.join(', ')}`)

    const result = await database().execute(statementFor(name, args))
    const rows = result.rows
    return schema.parse(normalizeDatabaseValue(rows))
  } catch (error) {
    throw compatibilityError(error, databaseFunction(name)) ?? toApiError(error)
  }
}

export async function callApiCommand(name: ApiRpcName, args: Record<string, unknown>): Promise<void> {
  try {
    await database().execute(statementFor(name, args))
  } catch (error) {
    throw compatibilityError(error, databaseFunction(name)) ?? toApiError(error)
  }
}

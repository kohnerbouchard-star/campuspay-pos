import 'server-only'
import type { ZodType } from 'zod'
import { sql } from 'drizzle-orm'
import { database } from '@/lib/db/client'
import { normalizeDatabaseValue } from '@/lib/db/normalize'
import { toApiError } from '@/lib/api/errors'

type RpcArgument = { readonly name: string; readonly cast: string }

const RPCS = {
  create_staff_session: [{ name: 'p_employee_code', cast: 'text' }, { name: 'p_pin_proof', cast: 'text' }, { name: 'p_session_token_hash', cast: 'text' }, { name: 'p_terminal_fingerprint', cast: 'text' }],
  authorize_session: [{ name: 'p_session_token_hash', cast: 'text' }, { name: 'p_terminal_fingerprint', cast: 'text' }, { name: 'p_permission', cast: 'text' }],
  revoke_staff_session: [{ name: 'p_session_token_hash', cast: 'text' }, { name: 'p_terminal_fingerprint', cast: 'text' }],
  catalog: [{ name: 'p_session_id', cast: 'uuid' }],
  create_payment_intent: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_items', cast: 'jsonb' }, { name: 'p_idempotency_key', cast: 'uuid' }, { name: 'p_coupon_code_fingerprint', cast: 'text' }],
  scan_payment_card: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_card_fingerprint', cast: 'text' }],
  confirm_payment: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_intent_id', cast: 'uuid' }, { name: 'p_student_pin_proof', cast: 'text' }],
  create_product: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_sku', cast: 'text' }, { name: 'p_name', cast: 'text' }, { name: 'p_category', cast: 'text' }, { name: 'p_selling_price_won', cast: 'bigint' }, { name: 'p_reorder_level', cast: 'integer' }],
  change_product_price: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_product_id', cast: 'uuid' }, { name: 'p_new_price_won', cast: 'bigint' }, { name: 'p_reason', cast: 'text' }],
  inventory_lots: [{ name: 'p_session_id', cast: 'uuid' }],
  receive_stock: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_supplier_name', cast: 'text' }, { name: 'p_supplier_invoice', cast: 'text' }, { name: 'p_purchase_date', cast: 'date' }, { name: 'p_shipping_won', cast: 'bigint' }, { name: 'p_other_costs_won', cast: 'bigint' }, { name: 'p_discount_won', cast: 'bigint' }, { name: 'p_notes', cast: 'text' }, { name: 'p_lines', cast: 'jsonb' }, { name: 'p_idempotency_key', cast: 'uuid' }],
  remove_stock: [{ name: 'p_session_id', cast: 'uuid' }, { name: 'p_product_id', cast: 'uuid' }, { name: 'p_lot_id', cast: 'uuid' }, { name: 'p_quantity', cast: 'integer' }, { name: 'p_reason_code', cast: 'text' }, { name: 'p_notes', cast: 'text' }, { name: 'p_idempotency_key', cast: 'uuid' }],
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
} as const satisfies Record<string, readonly RpcArgument[]>

export type ApiRpcName = keyof typeof RPCS

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
  const functionName = name === 'search_student_wallets' ? 'search_student_wallets_v2' : name === 'list_coupons' ? 'list_coupons_v2' : name
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
    throw toApiError(error)
  }
}

export async function callApiCommand(name: ApiRpcName, args: Record<string, unknown>): Promise<void> {
  try {
    await database().execute(statementFor(name, args))
  } catch (error) {
    throw toApiError(error)
  }
}

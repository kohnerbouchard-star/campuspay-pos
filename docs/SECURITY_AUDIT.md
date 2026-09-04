# Security and Modularity Audit

Generated: 2026-09-04T02:27:41.453Z

## Automated checks

- **PASS — No privileged key or HMAC secret referenced by client components**
- **PASS — Client components do not import server/admin database clients**
- **PASS — No generic balance or stock mutation endpoint exists**
- **PASS — No hard-coded student PINs or raw card identifiers in source**
- **PASS — Application modules remain bounded**: Largest: src/features/coupons/domain.ts (105 lines)
- **PASS — RLS is enabled in schema SQL**
- **PASS — Private schema access is revoked**
- **PASS — Privileged database functions pin search_path**
- **PASS — Idempotency control is represented in the database transaction layer**
- **PASS — Financial, inventory, and coupon operations use row locking**
- **PASS — Coupon codes use HMAC fingerprints rather than raw-code columns**
- **PASS — Coupon redemption limits are represented in the transaction model**

## Largest application modules

| File | Lines |
|---|---:|
| `src/features/coupons/domain.ts` | 105 |
| `src/features/coupons/ui/CouponForm.tsx` | 100 |
| `src/features/pos/ui/POSScreen.tsx` | 92 |
| `src/features/pos/domain.ts` | 89 |
| `src/features/inventory/domain.ts` | 79 |
| `src/features/inventory/costing.ts` | 78 |
| `src/features/pos/ui/PaymentDialog.tsx` | 76 |
| `src/features/pos/server.ts` | 74 |
| `src/features/pos/ui/CouponEntry.tsx` | 69 |
| `src/features/wallets/domain.ts` | 69 |

## API route inventory

- `src/app/api/accounting/intents/[intentId]/card/route.ts`
- `src/app/api/accounting/intents/[intentId]/confirm/route.ts`
- `src/app/api/accounting/intents/route.ts`
- `src/app/api/accounting/students/route.ts`
- `src/app/api/auth/activity/route.ts`
- `src/app/api/auth/login/route.ts`
- `src/app/api/auth/logout/route.ts`
- `src/app/api/auth/session/route.ts`
- `src/app/api/coupons/[couponId]/deactivate/route.ts`
- `src/app/api/coupons/route.ts`
- `src/app/api/inventory/adjustments/route.ts`
- `src/app/api/inventory/lots/route.ts`
- `src/app/api/inventory/products/[productId]/price/route.ts`
- `src/app/api/inventory/products/route.ts`
- `src/app/api/inventory/receipts/route.ts`
- `src/app/api/pos/catalog/route.ts`
- `src/app/api/pos/coupons/quote/route.ts`
- `src/app/api/pos/intents/[intentId]/card/route.ts`
- `src/app/api/pos/intents/[intentId]/confirm/route.ts`
- `src/app/api/pos/intents/route.ts`
- `src/app/api/reports/coupons/route.ts`
- `src/app/api/reports/inventory/route.ts`
- `src/app/api/reports/sales/route.ts`
- `src/app/api/reports/wallets/route.ts`
- `src/app/api/security/step-up/route.ts`
- `src/app/api/security/students/[studentId]/card-reset/route.ts`
- `src/app/api/security/students/[studentId]/pin-reset/route.ts`

## Interpretation

This static audit checks source boundaries and schema patterns. It supplements, but does not replace, database advisor checks and integration tests against the configured Supabase project.
# CampusPay v0.7.1 release notes

## Added

- Order-level coupon-code entry in the cashier cart.
- Fixed-won and percentage discounts.
- Minimum subtotal, percentage cap, validity window, total-use limit, and per-student limit.
- Admin-only coupon creation and deactivation.
- Coupon reporting permission separate from coupon management.
- HMAC coupon-code fingerprints and masked code hints.
- Final coupon revalidation within the atomic checkout transaction.
- Coupon redemption ledger linked to student and sale.
- Local import-resolution validation.
- Offline connection-configuration check.
- Deferred Supabase connection guide.

## Connection state

Supabase is intentionally unconfigured. No project was created, linked, queried, migrated, or modified. `.env.example` contains blank fields for the owner to populate later.

## Validation state

The local static suite, coupon policy runtime checks, SQL structure checks, import checks, and security/modularity audit pass. Full dependency-based Next.js checks remain to be run after installing dependencies. No hosted integration test was attempted.

# Database

The PostgreSQL model separates exposed identity/catalog records from private financial and security records.

- `public.staff_profiles`, `public.products` — operational identities and catalog records.
- `private.staff_credentials`, `private.staff_sessions`, `private.terminals` — employee authentication and terminal sessions.
- `private.students`, `private.student_credentials`, `private.student_cards`, `private.wallets`, `private.wallet_ledger` — closed-loop student wallet.
- `private.stock_receipts`, `private.stock_receipt_lines`, `private.inventory_lots`, `private.inventory_movements` — costed lot inventory.
- `private.payment_intents`, `private.sales`, `private.sale_items`, `private.sale_cost_allocations` — atomic POS ledger and COGS.
- `private.coupons`, `private.coupon_redemptions` — coupon policy and immutable redemption records.
- `private.audit_events`, `private.elevation_tokens` — protected-action evidence.

Stock on hand is derived from open lot quantities. Wallet balance is changed only by recorded ledger transactions. The default costing method is FIFO; LIFO remains available as a controlled system setting.

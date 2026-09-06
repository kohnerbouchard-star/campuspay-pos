# Release notes

## v0.9.0 — Online Store + Room Delivery

- Added customer storefront sharing the same CampusPay wallet and inventory as the physical POS.
- Added printed RFID/card number + student PIN customer authentication with a separate session cookie and network rate limiting.
- Added East Building Floor 2 Rooms 201–206 as active delivery destinations.
- Added West Building Floors 2–4 as non-orderable placeholders until room numbers are configured.
- Added atomic online checkout, shared coupon enforcement, FIFO/LIFO lot allocation, COGS, wallet ledger entries, and `ONLINE_STORE` sales channel attribution.
- Added customer order history and staff online-order fulfillment.
- Added production host separation support through `STAFF_ORIGIN` and `STORE_ORIGIN`.
- Preserved the physical POS and existing v0.8.1 Neon/PostgreSQL security model.

## 0.8.0 — Neon migration

- Replaced Supabase Auth and Supabase client packages with native employee PIN proofs and Neon Postgres.
- Added a server-only `DATABASE_URL` connection through `@neondatabase/serverless`.
- Added a whitelisted, parameterized PostgreSQL RPC adapter.
- Added dedicated staff credential records with lockout controls.
- Preserved least-privilege workspaces, the −₩15,000 wallet floor, card-first checkout, FIFO/LIFO costing, coupons, reports, and super-admin step-up authorization.
- Added a ten-module PostgreSQL schema and reproducible initial migration.
- Added connection, database-health, migration-build, and security-audit scripts.

- Added a one-time, proof-only demo bootstrap command for local acceptance testing.

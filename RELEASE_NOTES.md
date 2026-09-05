# Release notes

## 0.8.0 — Neon migration

- Replaced Supabase Auth and Supabase client packages with native employee PIN proofs and Neon Postgres.
- Added a server-only `DATABASE_URL` connection through `@neondatabase/serverless`.
- Added a whitelisted, parameterized PostgreSQL RPC adapter.
- Added dedicated staff credential records with lockout controls.
- Preserved least-privilege workspaces, the −₩15,000 wallet floor, card-first checkout, FIFO/LIFO costing, coupons, reports, and super-admin step-up authorization.
- Added a ten-module PostgreSQL schema and reproducible initial migration.
- Added connection, database-health, migration-build, and security-audit scripts.

- Added a one-time, proof-only demo bootstrap command for local acceptance testing.

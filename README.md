# MICA Money · CampusPay staff operations and student store

CampusPay is a closed-loop school wallet, point-of-sale, and room-delivery online store built with Next.js and Neon Postgres. Browsers call same-origin API routes; financial, inventory, credential, and coupon mutations execute through narrowly scoped PostgreSQL functions.

## Existing capabilities

- Employee code/PIN authentication with cashier, inventory-admin, accountant and super-admin roles.
- Card-first, student-PIN-second POS checkout; a −₩15,000 wallet floor; server-authorized wallet/cash/split tenders and expiring cash-event policy.
- Costed inventory receipts, lot allocation, FIFO/LIFO costing, COGS and reporting; ledger-backed operational wallet adjustments.
- Fingerprinted card/coupon identifiers; fixed/percentage coupons with validity, spend, cap and redemption limits.
- E202 student enrollment, elevated card/PIN replacement, student search and wallet history.
- Student store authentication with printed RFID/card number plus PIN; shared wallets, stock, coupons and sales; room delivery and staff fulfillment.
- East Building floor 2 rooms 201–206; West floors 2–4 remain non-orderable until actual rooms are configured.
- Separate staff/customer origins and host-only sessions; five-minute POS workstation lock, fifteen-minute other-workspace lock, thirty-second warning and server-authoritative session deadlines.

This remains a pilot until the [v1.0 release gates](docs/V1_LAUNCH_PLAN.md) are accepted. Refunds, cash-drawer close, complete historical pagination, real device acceptance and operational cutover must not be inferred from existing checkout tests.

## Repair the existing Mac installation

Do not rerun the September 7 secret-bearing installer: it overwrites local configuration with an obsolete database target. Do not regenerate card/PIN peppers on an existing installation.

Use the secret-free repair package or, after this change is merged:

```bash
cd ~/campuspay-pos
git pull --ff-only origin main
node scripts/repair-local.mjs
```

The repair requires a clean main checkout and preserves application secrets. It backs up and repairs only the recognized old/current CampusPay connection, verifies the runtime and 15 API capabilities, and starts local development. It does not migrate, bootstrap or change database data. Options: `--check-only`, `--no-start`, `--repo PATH`. See [local recovery](docs/LOCAL_RECOVERY.md).

## New workstation

Use Node.js 22.9 or newer. Clone the private repository and obtain the current private configuration through the owner's secure channel. Never overwrite an existing `.env.local`, store credentials in Git, reuse an old installer ZIP, or use an owner connection for the application. The package version alone does not identify the deployed commit.

With an approved current `.env.local` in place:

```bash
npm ci
npm run connection:check
npm run db:health
npm run dev
```

Local staff login is `/login`, student login `/store/login`, fulfillment `/orders`, enrollment `/students`, reports `/reports`, and event payment settings `/settings/payments` on `http://localhost:3000`. Students without a card go to E202; there is no online self-registration.

Production uses separately configured HTTPS `STAFF_ORIGIN` and `STORE_ORIGIN`, not localhost. The application must receive only restricted runtime credentials. The separately controlled direct owner connection is for approved migration tooling only. Normal startup never migrates. Preview/QA must not share live production credentials.

## Validation

```bash
node scripts/verify-local-repair.mjs
npm run validate:static
npm run typecheck
npm test
npm run lint
npm run build
npm run db:health
```

CI also migrates disposable local PostgreSQL, tests the actual runtime-role metadata checks with `scripts/verify-runtime-readiness.mjs`, and runs existing integration/browser validation. Local repair regressions include real local Git fixtures and mocked network/dependency/database boundaries. A capability check is not an exact migration-history audit or purchase-flow certification.

For isolated application testing use `npm run test:integration:isolated` and `npm run test:visual`, with a dedicated local `TEST_POSTGRES_URL`. Do not run demo bootstrap or isolated fixture commands against school data.

## Architecture and operating documentation

Role-specific UI → same-origin API → feature service → whitelisted PostgreSQL RPC adapter → `api.*` functions → private tables and immutable journals.

`src/app` holds pages/routes; `src/features` holds workflows; `src/lib/db` holds the restricted adapter; `database/schema` and `database/migrations` hold reviewed SQL. See [payments](docs/PAYMENTS.md), [enrollment](docs/STUDENT_ENROLLMENT.md), [online store](docs/ONLINE_STORE.md), [hardening evidence and limits](docs/PRE_MERGE_HARDENING.md), and the [launch plan](docs/V1_LAUNCH_PLAN.md).

Neon provides the database, not offline payment approval. Purchases require a working connection and an authoritative server result. Public deployment and unattended live operation require the release gates, not merely a passing build.

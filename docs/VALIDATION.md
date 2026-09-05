# CampusPay v0.8.1 validation

Validated on 5 September 2026. The tested application was published to `main` in commit `14f263ec0290fabdc491a4c3daf51f5114080fb2`.

Successful conversion, validation, and publication run: https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/33951731882

## Application validation

The converted application passed dependency installation, static/import checks, semantic TypeScript checking, 22 unit tests, ESLint, a Next.js production build, installation of all three migrations into an empty PostgreSQL 17 database, and the HTTP/browser integration suite. The seven validation gates passed before the application commit was pushed.

The integration suite reports these 19 successful scenarios:

- anonymous denial
- four role logins
- least-privilege denials
- negative-balance sale
- duplicate prevention
- wallet floor
- coupon limits
- accountant top-up
- four reports
- costed receipts
- FIFO allocation
- sold-out status
- fixed coupon
- coupon deactivation
- PIN reset and one-use approval
- persistent login lockout
- immutable ledger
- cashier idle expiry
- browser login and POS

Cross-origin POST rejection and parameterized array/text binding are also checked.

## Hosted Neon verification

The dedicated CampusPay database has the initial schema, bootstrap support, and migration `20260905070000_finish_neon` applied. Its restricted runtime login has no direct private-table access or bootstrap execution. Separate CP-prefixed test staff accounts and a zero-balance test student were created. Their credential proofs were checked against the values delivered in the private local setup package. Existing demo accounts were not reset.

Database-level smoke tests on an isolated Neon branch checked valid/invalid login, persistent failed-login counters, cashier permission denial, stock receipt, student PIN rejection, negative-balance sale, duplicate prevention, inventory deduction, and immutable journal enforcement.

## Local setup

The private local setup package is delivered separately from this repository. It supplies `.env.local`, test login details, and a Git Bash setup script. The script pulls `main`, preserves an existing local environment file, installs the committed dependencies with `npm ci`, checks configuration/database access, and starts the application on port 3000. It stops instead of discarding tracked local code changes.

Do not commit the private package, its login file, or `.env.local`. The supplied configuration is for local HTTP access at `http://localhost:3000`; production needs HTTPS and secure cookies. The prepared hosted database does not need to be migrated or bootstrapped again for this local setup. Do not independently regenerate the secrets used for existing PIN/card matching.

## Boundaries of these checks

The complete application suite ran against an isolated PostgreSQL 17 service on GitHub Actions, not against real student data. Hosted Neon was checked separately through database calls. The Windows setup script passed Bash syntax validation but has not been executed on the owner's computer. No physical RFID reader, school-network outage, production-scale load, backup restoration, or independent penetration test was performed. This release is suitable for local pilot testing; it is not a claim of production certification.

No real database credentials, staff PINs, or local application secrets are included in the repository or CI artifacts. The ongoing validation workflow runs against its own isolated database.

# MICA Money student enrollment

`/students` is the E202 enrollment and account directory for Super Admin staff.
The authoritative student model contains student ID, display name, and active status;
no grade, year, email address, or additional personal data is introduced.

## Authorization and enrollment

- The page and HTTP API require `students.manage`. Only Super Admin receives it.
- The server module and database RPC also verify the Super Admin role explicitly.
- `api.enroll_student` creates the student, zero-balance wallet, slow-hashed PIN
  credential, physical card assignment, immutable enrollment receipt, and audit event
  in one transaction. A late failure rolls all these records back.
- PINs must contain 4–12 digits and match their confirmation. The application sends
  the existing keyed PIN proof to PostgreSQL, which uses bcrypt with cost 12.
- Raw card reads are fingerprinted on the server. The browser displays only
  “Card detected”; the PIN, card fingerprint, and request proof are never returned.
- A card already present in card history cannot be enrolled again. Student ID checks
  ignore case and surrounding spaces without rewriting legacy identifiers.
- An actor-wide limit permits 30 enrollment attempts per minute across all terminals.
  Duplicate attempts count toward that limit. Exact successful retries do not.
- An idempotency key is bound to the actor and full enrollment request. Concurrent
  retries return the original receipt; reuse with changed data is rejected.

## Wallet funding

Every new wallet starts at **₩0**. A non-zero opening amount is not supported, and
the strict request schema rejects an additional opening-balance field. Enrollment
does not post a zero-value wallet journal because the existing ledger prohibits
zero-value entries. The audit explicitly records the opening balance of zero.
Funding uses the normal Accounting card/PIN workflow and its ledger and receipt.

## Existing accounts and protected actions

The directory shows account status, live wallet balance, card status, temporary PIN
lock status, enrollment date, and the enrollment audit reference where available.
The detail action opens `/security?studentId=…` for a PIN reset or card replacement.

Credential operators use `api.search_security_students`, which permits the existing
`security.credentials.request` permission without disclosing wallet balances.
The existing single-use authorization remains bound to the staff session, student,
and action and expires after 60 seconds. Switching students or actions clears the
browser authorization and sensitive fields. Card replacement requires a separate
confirmation after the card is captured. Existing database triggers immediately
revoke customer sessions after a card or PIN change.

## Files and verification

- Schema: `database/schema/014_student_enrollment.sql`
- Versioned migration: `database/migrations/20260907120000_student_enrollment.sql`
- Domain checks: `src/features/students/__tests__/enrollment.test.ts`
- Local integration helper: `scripts/enrollment-integration.mjs`

The integration helper checks authorization, validation, duplicates, exact record
counts, zero opening balance, credential hashing, safe audit payloads, idempotent
concurrency, and rollback after an injected failure at audit insertion. It also
checks immediate student store access and purchase, protected card replacement,
old-session revocation, and the enrollment throttle. The helper refuses remote
database hosts and must be run through the isolated integration harness.

Manual acceptance still includes a physical card reader at E202, the student PIN
privacy setup, actual printed card-number compatibility with store sign-in, and
handing the newly activated card to the correct student. If the browser loses an
enrollment response, retry the unchanged form or search the student ID before
starting again. No secrets are persisted in browser storage for recovery.

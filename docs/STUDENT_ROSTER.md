# Student roster and Year identifiers

## Scope

The student directory now reads a versioned, restricted `api.search_students_v2` function. It shows the student's stable `student_code`, current `year_group`, `academic_year`, wallet balance and card/PIN state. Year filtering and bounded 50-row pagination replace the directory's previous first-50-only behavior. Existing `api.search_students` and enrollment interfaces remain compatible.

A student record plus a zero-balance wallet is a roster entry, not card issuance. The operation must not insert `student_cards`, `student_credentials` or credential-based `student_enrollments` rows. No fake card number, placeholder PIN, fabricated deposit, or online login is created. Card/PIN issuance for a pre-existing roster entry remains a separate follow-up workflow; never work around it by creating a duplicate student.

## Year policy

Use the school owner's explicitly supplied Year labels. Do not convert historical Grade labels from other documents, infer a year from a name, or silently promote students. Store the academic year alongside the Year label. Keep the stable student ID unchanged on future promotion. A NULL year means unconfirmed, not Y0.

The 18 September 2026 roster supplied by the owner has 135 entries: Y6 18, Y7 15, Y8 19, Y9 24, Y10 24, Y11 18, Y12 17. It contains two identical display names in different years. Keep both, with different stable IDs. The import data itself is private operational data and is deliberately not committed to this repository.

## Security and validation

The new endpoint `/api/students/roster` requires `students.manage` and a Super Admin role at the server and database boundaries. Query length, Year, and page offset are bounded. SQL identifiers are in the fixed RPC registry; values remain parameterized. The API returns boolean PIN presence, never credential hashes or raw identifiers. The detail page distinguishes a missing PIN from an unlocked existing PIN.

Migration: `20260918110000_student_roster_years`; source module 022 is byte-identical. The migration is additive and contains no student names, credentials, destructive cleanup, bootstrap, or wallet funding. Static/unit/build checks and a disposable-PostgreSQL smoke test validate 135 synthetic unissued records, year counts, duplicate names, 50/50/35 pagination, denied cashier/unknown sessions, invalid input and private-table denial. The integration fixture transaction is rolled back.

## Operational delivery and remaining work

An isolated rollback branch was created before the requested roster/cleanup operation. The broad demo-deletion rehearsal was blocked by the execution safety layer; that blocked operation did not delete records or modify the live database. Do not mark demo cleanup complete on that basis and do not bypass the protected-journal controls. Final live import/backup/deactivation status must be recorded in the PR handoff after actual verification.

The v1.0 tracker remains issue #4. The demo/opening-position gate remains issue #5 until approved cleanup is actually completed. Refunds, daily drawer close, existing-roster card/PIN issuance, account administration, actual inventory setup, deployment/recovery and school-device acceptance remain separately tracked; this change does not claim that the entire launch plan is complete.

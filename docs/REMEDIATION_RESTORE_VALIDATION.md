# Restore and dependency regression repair

Continuation of [October 1 remediation](REMEDIATION_2026_10_01.md).

The first full CI execution reached the restore drill and exposed `schema public
already exists`. A new template0 database can already contain an empty public
schema while the archive contains CREATE SCHEMA public. Verification now checks
the authenticated archive TOC, connects only to its own newly created localhost
database, verifies that database identity, and removes the empty default schema
with RESTRICT only when the archive recreates it. No CASCADE, ignored restore
errors, skipped schema objects, or production restore writes are used.

Additional checks preserve the original database/public-schema identity and
confirm cleanup of the uniquely created verification database. URL options cannot
redirect the validated host/database; inherited libpq target overrides are removed.
Table digests use binary C ordering for consistent cross-locale comparison.
The encrypted archive size is checked before writing, matching the restore limit.

The complete npm audit also identified vulnerable development-only brace-expansion
entries. npm-generated registry metadata updates only versions 1.1.18 to 1.1.21
and 5.0.9 to 5.0.12; all unrelated platform metadata stays unchanged. The reviewed
lockfile Git blob is e4925ca2f7dac4544ef462c15657bd13caa810d4. The temporary
proposal publisher is removed from the final candidate. Full dependency auditing,
including development tools, is now an enforced CI gate rather than an informational
report. Full candidate and actual-main validation outcomes belong in the PR/release
record; these source notes do not certify a live installation or retained live backup.

Backup publication uses a unique same-directory mode-0600 `.partial` file, flushes
its complete bytes, and publishes with an exclusive hard link. Existing backups
cannot be overwritten. Failed writes/flushes/link creation never expose a partial
archive under the final name; interrupted processes may leave only `.partial`
files. The directory entry is flushed too. Native failure-injection tests cover
partial writes, disk/flush/link errors, existing destinations and cleanup.
This implementation requires a filesystem supporting hard links and directory
fsync; unsupported filesystems fail rather than silently weakening publication.

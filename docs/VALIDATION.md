# Validation

The GitHub validation workflow installs pinned dependencies, checks TypeScript, runs unit tests and lint, builds Next.js, and runs the HTTP integration test against an isolated PostgreSQL service. Live Neon verification is separate. Check the workflow result for the exact commit; a schema-only check is not an application test. No real credentials are included in CI.

# Product photos — isolated implementation workstream

Base: integration commit `4e75bf8883df592fee52e9521ab18a0f0c706f5a`, tree `68adb211f5a71cf513eb34dde726244288e6cb13`.
Branch: `feat/product-photos-20261008`; target: `feat/effective-access-workspaces-20261005`.

Owns product photos only, including editor/catalog presentation, server-side image validation and Vercel Blob adapter, additive schema 051 and its timestamped migration, and isolated acceptance coverage. No student photos. Migration 050, PR42/main release, existing migrations and release packages belong to other workstreams and must remain unchanged.

This branch is deployment-held from its first commit. No merge, deployment, hosted migration, paid storage provisioning, credential creation, maintenance change or reopening is authorized. Blob storage is not provisioned. Public product-image visibility requires an explicit operator decision before provisioning. Originals must never be published.

Implementation and qualification are in progress. The initial workflow only produces a reproducible dependency-lock candidate in an isolated GitHub runner; it does not certify the feature. Final qualification must run against the final committed source and lockfile, with synthetic images/products and disposable localhost PostgreSQL only.

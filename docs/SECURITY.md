# Security model

CampusPay follows default-deny and least privilege.

- The web runtime connects as a limited PostgreSQL login that inherits only `campuspay_runtime`.
- `campuspay_runtime` has no direct access to public/private tables or private functions; it can execute only `api.*` functions.
- Every privileged function pins `search_path`, rechecks the active staff session, and enforces one specific permission.
- Staff and student PINs are converted to keyed HMAC proofs in the server and then stored as slow `pgcrypto` hashes. Raw PINs are not stored.
- Card and coupon codes are stored only as keyed HMAC fingerprints.
- Wallet and inventory corrections are append-only counter-transactions rather than destructive edits.
- Checkout uses row locks and idempotency keys so sale, wallet, stock, coupon, and audit changes are atomic.
- The register initiates inactivity sign-out after five minutes, with bounded protection for payment/receipt flows; other staff workspaces do so after 15 minutes. The client attempts server sign-out and attempts to leave the workspace if revocation cannot be confirmed; an unsaved-change prompt can prevent navigation. Separately, the server session has a 15-minute sliding inactivity expiry capped at eight hours from creation.
- Student credential resets require a one-use, 60-second super-admin authorization tied to one student and one purpose.

`DATABASE_URL` and all peppers/HMAC secrets are server-only and must never be committed or prefixed with `NEXT_PUBLIC_`.

# Product-photo activation handoff — 2026-10-08

The product-photo implementation and unsaved-navigation repair are already on main through PR50/54. PR55 adds general workflow clarity, not provider activation. This follow-on review uses synthetic merchandise images with the local fake adapter. No student photos, real record deletion, provider provisioning, credential retrieval, hosted flag change or production upload is part of this work.

## State and supported boundary

The existing server config requires `PRODUCT_PHOTOS_ENABLED`, `PRODUCT_PHOTOS_PUBLIC_ACCESS`, `PRODUCT_PHOTOS_ENVIRONMENT`, `PRODUCT_PHOTOS_NAMESPACE`, `PRODUCT_PHOTOS_BLOB_PUBLIC_ORIGIN` and a matching server-only `PRODUCT_PHOTOS_BLOB_READ_WRITE_TOKEN`; see `configuration.env.example`. The token must be supplied through the provider's approved secret interface, never this document or a chat. Hosted environments reject the local fake adapter. Product metadata and photo save are separate operations; upload does not implicitly publish the photo reference.

Local coverage includes decode/re-encode, metadata removal, authorization, request ownership, stale revisions, lost response, save/cancel/recovery and cleanup protection. The follow-on forced-exit check verifies an unfinished photo can neither stop a security exit nor cause a save/cancel request on exit, and preserves the opaque recovery reference. These tests do not establish actual Blob behavior.

## Owner handoff before actual-provider testing

Obtain specific approval for a separate public test Blob store, persistent storage access and cost; identify its owner and intended isolated test deployment/database. Agree that product image URLs are publicly readable and cached copies may outlive removal. No production flag or credential changes are authorized by the local review.

After that approval, the owner provisions the test store and supplies its token in the isolated deployment's secret settings. Use a dedicated test namespace and exact HTTPS public origin. Set environment `test`; keep all production settings unchanged. Do not reuse production records or upload originals containing personal data.

Run the following acceptance against synthetic products and known test-owned object keys:

1. Upload a generated PNG/JPEG/WebP, validate it, inspect the preview, explicitly save, reload and confirm the same image in editor, POS and customer catalog. Confirm metadata has been stripped and originals are not published.
2. Replace and remove the photo, checking that product identity, price, stock, wallets and immutable receipt history remain unchanged.
3. Interrupt the upload/save response; recover the original request after reload and reauthentication. Confirm one outcome and no duplicate operation or unintended delete.
4. Reject unauthorized, mismatched-store, invalid-image and stale-revision requests. Verify that public URLs contain only the approved origin/namespace and immutable generated keys.
5. Run bounded cleanup only for test-owned candidates after the implemented grace/lease rules; confirm current references and active recoverable uploads remain protected. Record actual caching/removal behavior separately from application reference removal.

Record deployment SHA, test namespace, synthetic receipt/reference counts, provider results, non-sensitive screenshots and cleanup outcome. Do not export tokens, auth cookies or full sensitive request logs. Production activation requires a separate approved store/configuration and approved merchandise-image mapping after these tests pass.

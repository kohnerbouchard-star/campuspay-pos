# CampusPay and MICA Store visual refresh

## Purpose

The owner asked for a more engaging interface because the application felt utilitarian. This refresh builds on the deployed navigation improvements at main `d2a974b45c73d6b6e25bd35778864068cdf2c3c0`.

The visual direction combines a deep navy foundation, vivid teal actions, restrained warm accents, an ice-blue canvas and white work surfaces. Staff operations keep their task-focused layout; the student store receives a more expressive catalog and welcome area.

## What changes

- Staff navigation has a CampusPay identity, task-specific decorative icons, clearer selected states and a compact account panel. Its existing groups, permissions, route matching, desktop scrolling and mobile menu behavior are retained.
- Both sign-in surfaces use the same visual language. The student-facing name is MICA Store; MICA Money remains the card, wallet and payment name. Mobile layouts prioritize the form.
- Product categories use consistent icons and colors, without inventing product photography or metadata. The register and store emphasize product names, prices, availability and add controls.
- Carts, totals, wallet information, order details, tables, forms, feedback, report summaries and shared dialogs use the updated design tokens.
- Body text is 16px by default. Functional labels and controls generally use at least 14px; secondary metadata uses at least 12px in the refreshed navigation and store. Mobile header information reflows instead of shrinking to tiny text.
- Hover and press motion is restrained and disabled for reduced-motion users. Keyboard focus remains visible, and existing control labels and focus behavior are preserved.

No new runtime dependency or external asset request is introduced. There are no database migrations, API/service changes, feature activations, payment calculation changes or production data mutations.

## Relationship to pending management work

The refresh is independent of draft PR #38 and its database migration. That candidate's confirmation dialog uses the shared dialog, field, action-row and danger-action styles refreshed here. Its four management-specific CSS rules do not conflict with this change. This PR does not claim to deliver or release the pending product/student management features.

## Verification and release status

Local type checks, lint (one pre-existing unused-variable warning), 349 unit tests, 47 navigation regressions, native API recovery checks, import/syntax checks, schema consistency and application security checks passed during implementation. The production build compiled successfully. Anonymous staff and store sign-in pages were inspected at 1440px and 390px, with zero browser errors or horizontal page overflow.

The existing authenticated PostgreSQL/browser/financial suites remain enabled. The PR records the exact remotely tested source tree and final results; local sign-in screenshots alone are not authenticated workflow certification.

The baseline's complete dependency audit currently reports one unpatched development-tool advisory, [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), propagated through five dependency entries. The production-only audit reports zero vulnerabilities. This refresh does not change dependency versions or exclude the finding. The workflow records the full audit first, continues collecting functional evidence, and enforces that same audit result before completion. A failed audit still fails the job. This diagnostic ordering is not a release exception.

Do not describe a successful Vercel preview build as a fully cleared release gate or as an updated production deployment. Deployment status and any remaining blocker must be stated separately.

## Rollback

Revert this application's presentation commit through the normal release process, preserving unrelated changes. No database rollback is required.

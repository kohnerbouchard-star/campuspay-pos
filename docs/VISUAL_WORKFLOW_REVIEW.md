# Visual and interaction review — 2026-10-08

Local follow-on to PR55, based on main `abf88e3f9581baa28db2c5c1096f87d160aad804`, on `feat/visual-workflow-review-20261008`. This work is not published or deployed. PR55's separately verified production release does not include these fixes.

## Method and research

Rendered the real Next application against disposable localhost PostgreSQL and synthetic people/products, with intercepted responses for specific failure states. Preserved the existing navy/teal palette, typography, rounded panels and workspace navigation. Examined task hierarchy, spacing, readable values, narrow layouts, recovery messages and modal behavior rather than replacing the design language.

The review used [W3C reflow](https://www.w3.org/WAI/WCAG22/Understanding/reflow.html), [text contrast](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html), [non-text contrast](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html), [target size](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html), [modal dialog behavior](https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/), and [financial/data error prevention](https://www.w3.org/WAI/WCAG22/Understanding/error-prevention-legal-financial-data.html). This supports readable controls, contained scrolling where tables require it, keyboard focus management and review/recovery for consequential actions. It does not require a confirmation dialog for every ordinary action.

[GOV.UK tables](https://design-system.service.gov.uk/components/table/), [buttons](https://design-system.service.gov.uk/components/button/) and [spacing](https://design-system.service.gov.uk/styles/spacing/) informed numerical alignment, a clear primary action and consistent separation. [Nielsen's usability heuristics](https://www.nngroup.com/articles/ten-usability-heuristics/) informed visible system status, consistent controls and useful recovery messages. These are design references, not claims that CampusPay implements either design system.

## Confirmed improvements

| Finding | Change and evidence |
| --- | --- |
| Dirty photo editor can prevent automatic navigation after failed logout | `StaffSessionBoundary`, `session-exit.ts` and `use-inactivity-lock.ts` conceal and make the workspace inert before awaiting revocation. Existing children and recovery storage remain mounted. The visible exit message truthfully distinguishes concealment from confirmed server logout. |
| A late payment result can open a modal after concealment and block the exit link | `Dialog.tsx` suppresses new native modal activation and focus restoration during exit. Real-app test holds logout, delivers a recovered receipt, confirms the receipt remains mounted but closed, and clicks the exit link. |
| Student's separate unload handler can still obstruct forced exit | `StudentDetail.tsx` now exempts security exit, as does the shared photo guard. Test proves the draft guards ordinary unload first, then verifies forced navigation and retained recovery. |
| Long product names overflow the POS page | Scoped cart rows wrap names above quantity controls. Baseline overflow measured 21px at 1440px, 48px at 390px and 62px at 320px; final captures fit. |
| Large product price/cart totals overflow at 320px | Product footer and total rows wrap; full currency values remain visible. A synthetic ₩99,999,999 product multiplied by 40 exercises ₩3,999,999,960. Baseline overflow was 6px at 320px. |
| Input boundaries and disabled explanations are too faint | Shared field borders use `#7b8da2` instead of `#b8c7d7` (3.40:1 versus 1.72:1 against white); disabled fieldsets no longer fade labels and explanations a second time. Native disabled controls remain disabled. |
| Several controls and panels lack consistent hierarchy | Administration, funding and refund pagination use existing button styles; terminal management uses the existing table-link style. Inventory Add product moves to the header as its primary action. Adjacent panels receive spacing, and form paragraphs no longer double default margins with grid gaps. |
| Funding select and monetary columns are inconsistent | Operation selector uses the shared labeled field pattern; monetary columns align right. |
| Report selector and submit action are separated across the page | Related controls now form one wrapping group with bounded selector width. All report variants are explicitly submitted during final capture. |
| Disabled-state text is repetitive or exposes implementation details | Cash removes the duplicate disabled notice while retaining eligibility explanations. Refunds explain availability and recovery without asking an operator to reason about migrations. |
| Anonymous `/access-unavailable` shows a generic application error | The route redirects only authentication failures to sign-in; an authenticated account with no permissions still sees its real no-workspaces state. Both are captured. |

Independent source/screenshot review identified the late-dialog and separate student-unload gaps during implementation. Both were fixed and re-reviewed; no remaining confirmed finding was reported in that focused review. Concealment is a local unattended-screen safeguard, not a substitute for server authorization or revocation.

## Screen-by-screen coverage

Final visual capture covers 33 route/state combinations at 1440, 390 and 320 CSS pixels: 99 screenshots plus five root-route redirect records. All screenshot metadata was inspected; representative desktop/mobile captures for each route family were visually reviewed. This is not a claim of pixel-by-pixel inspection of every image.

| Screen/family | Rendered state and interaction coverage |
| --- | --- |
| POS | Catalog, empty cart, long names, large totals, cashier permissions; late recovered receipt and exit behavior. |
| Orders | Empty queue plus populated synthetic queue, lookup/detail/back focus, transition confirmation, failed refresh and lost-response recovery in workflow tests. |
| Students | Directory, accountant view, selected account modal, dirty status exit and roster enrollment availability; existing navigation checks cover student focus/leave behavior. |
| Inventory | Directory and inventory-admin view, prominent Add product; actual photo editor draft, staged upload, navigation, forced exit and recovery using local fake storage. |
| Coupons | Directory plus synthetic active coupon confirmation, committed change and failed-refresh recovery. |
| Funding | Disabled-new-operation state, journal and synthetic populated/error/retry states. Existing financial permissions and unknown-result behavior unchanged. |
| Cash register | Disabled-new-shift state and closed-shift history, populated synthetic discrepancies and review states. |
| Cash movements | Availability explanations and links; unsupported movements remain unsupported. |
| Full and item refunds | Disabled-new-refund/recovery state and narrow controls; this review does not requalify every native refund transaction. |
| Reconciliation | Empty activity plus synthetic load failure/retry/discrepancy states. |
| Reports | Sales, inventory, wallets and coupons; explicit chooser submit, table containment and synthetic error/retry cases. |
| Security | Directory, account selection/back focus and independent-approval messages; no change to authorization. |
| Administration | Employee/terminal directory, control hierarchy and responsive layout; no new administrative powers. |
| Payment settings | Disabled cash policy and synthetic policy read/update/error states. |
| Cash history | Empty and synthetic populated history, narrow table navigation and recovery. |
| Complete enrollment | Existing roster identity and disabled feature explanation; no production issuance. |
| Store | Catalog, orders and account at all three widths using a synthetic customer; no student photos. |
| Sign-in/access | Staff/store sign-in, signed-out redirect and genuinely authenticated no-permission account. |

Data tables retain their labeled, focusable horizontal scroll regions when columns require two-dimensional reading. Page-wide horizontal overflow is rejected. This preserves values rather than truncating financial evidence to make a screenshot fit.

## Verification and limitations

Final focused results: 12 forced-exit groups, 4 session-exit groups, 2 photo-navigation width groups, 12 workflow-clarity groups, 20 workflow-state groups, 5 navigation groups covering 23 routes, and 99 final visual screenshots. Final capture recorded zero page-overflow failures, browser errors, unnamed fields or supported-pair contrast candidates. Commands and machine-readable results are retained with the local evidence artifact. Build, typecheck, lint and focused browser scripts run against this local patch; the existing unit suite has 503 passing tests. Lint retains one pre-existing unused `setRevision` warning in `AccountingScreen.tsx`.

The forced-exit harness has 12 passing groups across desktop/mobile: failed/stalled revocation, successful revocation, expired heartbeat, successful manual exit, late receipt and dirty student status. It checks no cancellable exit prompt, no photo save/cancel caused by exit, retained opaque recovery and actual local session revocation where applicable. A confirmed payment recovery may clear its own resolved marker; concealment does not erase it.

The photo-navigation harness also waits for the destination page to render before testing another navigation; waiting only for its URL caused an intermittent premature reopen. Prompt-count, retained-draft and no-write assertions remain intact.

The visual scanner asserts page overflow and browser errors. Text-contrast, unnamed-field and target measurements are diagnostics. Contrast excludes gradients, translucency, disabled/inert content and opacity effects; no candidates among its supported pairs is not WCAG conformance. Small inline targets need contextual spacing/exception judgment. No screen-reader, physical-device, Safari/Firefox, browser zoom or actual-provider certification is claimed. Narrow CSS viewport testing is not a substitute for all of these.

The initial baseline report-variant captures changed the selector without submitting it, so those nine images still show the default sales report and are not valid before-images for inventory/wallet/coupon reports. Final capture submits each choice and verifies its URL. Other baseline captures remain useful evidence of the confirmed overflow and visual defects.

## Remaining boundaries

Permanent deletion remains a policy decision, not an implemented button: see [the deletion proposal](PERMANENT_DELETION_PROPOSAL.md). Existing accepted policy preserves financial identities and immutable management history; deciding which setup evidence may be removed, identifier reuse and tombstone retention precedes backend expansion.

Actual photo-provider testing/activation remains separate: see [the activation handoff](product-photos/ACTIVATION_HANDOFF.md). No credentials, persistent provider access, production flags or production uploads were changed. No new dependency, migration, financial writer or permission expansion is introduced here.

## Independent final review follow-up

An independent reviewer inspected 38 images, representing all 33 captured state families, and found one additional medium contrast inconsistency: store CSS-module fields bypassed the shared control border (about 1.65:1 on white). Store field/search borders now use the same 3.40:1 control token. Refund lookup forms use a scoped start-aligned layout to keep the action next to the reference; full-sale lookup failure copy now directs the operator to check the reference/connection.

Remaining low-severity observations: some mobile financial tables need clearer horizontal-scroll cues; disabled funding/movement forms remain long before history. These are discoverability/density follow-ups, not evidence of broken scrolling or authorization. Their populated-state/interaction variants need design verification before structural changes. The independent session review found no blocking defect; explicit gaps include dirty-draft plus failed manual logout, real concurrent payment completion, other browser engines and assistive technology.

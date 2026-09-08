# Visual QA evidence

212 captures cover 56 interface states at 1440, 1024, 768, and 390px, plus a phone viewport check of the transaction register. All data shown is synthetic localhost test data. The browser completed enrollment, credential reset, student ordering, picking through delivery, wallet history, cash/split payments, and keyboard focus checks.

No unexpected browser errors, document overflow, missing visible field labels, or unnamed buttons were found in the final run. Deliberate 401/503 responses tested login errors and service recovery. Main text/action colors pass the measured AA contrast thresholds.

The selected full-size images below are retained in Git. The complete capture manifest is [browser-results.json](browser-results.json); all full-matrix images remain under the local ignored `.validation/visual/` directory and can be regenerated with `npm run test:visual`. [Neon results](neon-results.json) record six passed checks and verified fixture rollback.

Wide financial tables scroll horizontally on phones. Long dialogs scroll within the viewport and retain keyboard focus. Full-page dialog screenshots also include the document below the viewport; the native backdrop covers the active viewport. The report register was additionally checked while scrolled into the visible phone viewport, avoiding a full-page Chromium painting artifact.

| Screen / state | Screenshot |
| --- | --- |
| Staff login · 1440px | [Open](staff-login-1440.png) |
| Student login · 390px | [Open](student-login-390.png) |
| Student e202 help · 390px | [Open](student-e202-help-390.png) |
| Students · 1440px | [Open](students-1440.png) |
| Enrollment ready · 390px | [Open](enrollment-ready-390.png) |
| Enrollment success · 1440px | [Open](enrollment-success-1440.png) |
| Security card replacement · 390px | [Open](security-card-replacement-390.png) |
| Pos · 1440px | [Open](pos-1440.png) |
| Pos cash cart · 768px | [Open](pos-cash-cart-768.png) |
| Pos cash review · 1440px | [Open](pos-cash-review-1440.png) |
| Pos cash receipt · 390px | [Open](pos-cash-receipt-390.png) |
| Pos split review · 1440px | [Open](pos-split-review-1440.png) |
| Pos split receipt · 1440px | [Open](pos-split-receipt-1440.png) |
| Student store · 390px | [Open](student-store-390.png) |
| Student order review · 390px | [Open](student-order-review-390.png) |
| Student delivered timeline · 390px | [Open](student-delivered-timeline-390.png) |
| Student account · 390px | [Open](student-account-390.png) |
| Staff orders picking · 1440px | [Open](staff-orders-picking-1440.png) |
| Inventory · 1440px | [Open](inventory-1440.png) |
| Inventory receipt · 1440px | [Open](inventory-receipt-1440.png) |
| Inventory adjustment · 390px | [Open](inventory-adjustment-390.png) |
| Accounting · 390px | [Open](accounting-390.png) |
| Accounting wallet history · 1440px | [Open](accounting-wallet-history-1440.png) |
| Accounting sales · 1440px | [Open](accounting-sales-1440.png) |
| Coupons · 390px | [Open](coupons-390.png) |
| Reports · 1440px | [Open](reports-1440.png) |
| Reports · 390px | [Open](reports-390.png) |
| Reports register · 390px | [Open](reports-register-390.png) |
| Payment settings · 390px | [Open](payment-settings-390.png) |

Visual review corrected table containment on phones, report total typography and date controls, mobile navigation height, student name/ID separation, POS coupon controls, enrollment HTML validation, and dialog Tab/Shift+Tab containment.

## September 8 remediation evidence

The current run includes the five-minute register warning and its actual
**Stay signed in**, pointer, keyboard, and touch handlers using a controlled
browser clock. It also verifies real card-first Split (no pre-scan contribution),
server capacity, a maximum contribution, manual remainder, cash/PIN review, and
same-intent receipt recovery after deliberately losing a successful response.
The amber unknown-result warning receives focus and its recovery action is
visible within the phone dialog viewport.

A real 15-second event deadline removes Cash/Split and resets the new cart to
MICA Money. A deliberately absent required RPC shows **Database update required**
with retry; restoring the capability makes retry succeed. The separate
[actual old-schema result](old-schema-results.json) verifies an application
connected to a database containing only the four pre-refresh migrations.

[Development verification](dev-browser-results.json) confirms staff/student
sign-in pages render, `icon.svg` loads, and the legacy `/favicon.ico` probe returns
200 through the icon redirect. No browser errors or error overlay appeared;
the normal React DevTools recommendation is allowed. The connected browser was
unavailable in this session, so the existing isolated Chromium harness was used.

The new states were captured at all four requested widths and representative
images were inspected directly, including native dialog scrolling, warning
visibility, text wrapping, local event timestamps, split money values, the
required-room hint, the estimated-limit warning, login, enrollment, and settings.
Real reader, E202, cash/change, and school workflow acceptance remain human tasks.

| Remediation state | Selected evidence |
| --- | --- |
| Explicit timeout warning · 390px | [Open](pos-timeout-warning-390.png) |
| Split card step · 1024px | [Open](pos-split-card-1024.png) |
| Split wallet capacity · 1440px | [Open](pos-split-capacity-1440.png) |
| Maximum contribution · 390px | [Open](pos-split-maximum-390.png) |
| Manual cash remainder · 768px | [Open](pos-split-cash-remainder-768.png) |
| Cash/PIN review · 390px | [Open](pos-split-review-390.png) |
| Unknown result and recovery · 390px | [Open](pos-payment-result-unknown-390.png) |
| Event active · 1440px | [Open](pos-event-active-1440.png) |
| Event expired · 390px | [Open](pos-event-expired-390.png) |
| Database update required · 768px | [Open](pos-database-update-required-768.png) |
| Checkout estimate and room hint · 390px | [Open](student-checkout-limit-warning-390.png) |
| Development login and icon metadata · 1440px | [Open](development-login-icon-1440.png) |

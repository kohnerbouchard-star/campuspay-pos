# Visual QA evidence

172 captures cover 45 interface states at 1440, 1024, 768, and 390px, plus a phone viewport check of the transaction register. All data shown is synthetic localhost test data. The browser completed enrollment, credential reset, student ordering, picking through delivery, wallet history, cash/split payments, and keyboard focus checks.

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

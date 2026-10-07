# PR45 browser continuation — 2026-10-07

Continue the existing branch and PR45, not PR42 or checkout PR44. The starting remote head was verified as `7ee06e52bd1d785fcd0363b94a68e3dd644659d0`.

## Observed causes before correction

Diagnostic-only commit `0121d67782d73fefd1648e6015e10609ce451093` kept the failing suite unchanged. In [run 37554566631, UI job 112577706390](https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/37554566631/job/112577706390), the real rendered fixture showed:

- No browser console messages, page errors or failed requests. HTML, JavaScript, CSS and the synthetic roster GET all returned 200. The roster row was rendered.
- The select exists with one accessible role/name: `combobox "Student Year"`. The exact role-based locator matched one element.
- The enclosing label's descendant text is `Student YearAll yearsY1Y2Y3Y4Y5Y6Y7Y8Y9Y10Y11Y12Y13`. The exact label-text locator matched zero elements. Waiting longer cannot fix this semantic mismatch.
- The fixture served text without a charset: its actual DOM showed `MICA Money Â· E202` and `1â€“1 of 1`. Its missing UTF-8 declaration would break the exact dialog-name and pagination assertions after the label was fixed.

After those corrections, exact commit `90a99610c2a560bf886fabe8dd66e41adbbafc3e` passed label/encoding checks and exposed a real focus defect in [run 37555694698](https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/37555694698). Tab escaped the native student dialog. A local Chromium reproduction using the same DOM and handler confirmed that the trap omitted `summary` and included hidden descendants of collapsed `details` because those descendants still have layout rectangles. Forward Tab moved to BODY after the summary; reverse Tab attempted to focus the hidden Manage Status button and stayed on Close.

## Corrections and regression coverage

The suite uses exact combobox roles/names for Student Year and the identically wrapped Preset select. It additionally checks unique matches, exact accessible names, the 14 year options, and the real UTF-8 eyebrow. Both fixture servers explicitly serve HTML/JavaScript/CSS as UTF-8 and declare a meta charset. Every original selection, layout, focus, list state, access save/recovery, readiness race, draft protection and zero-mutation assertion is retained. The 12-second action timeout is unchanged. Failure output includes DOM, accessibility, bounded console/network diagnostics and a screenshot.

`Dialog.tsx` now includes summary controls, explicitly excludes hidden collapsed-details descendants, disabled/inert/invisible controls and controls belonging to a nested dialog. Existing topmost-dialog event handling, Escape veto, busy protection and focus return are unchanged. `assert-dialog-focus.mjs` additionally exercises the actual components at desktop/mobile widths: first-to-last and last-to-first focus with collapsed and expanded details, 32 forward/reverse keyboard movements, native modal state, Escape and row focus return. The original full UI suite's focus loops are unchanged.

The real-component fixture stays outside application routes; all requests are synthetic and loopback-only. Native authorization and financial tests are separate. No dependency, server authorization, financial endpoint or migration change is included.

## Evidence and non-waived failures

Original artifact upload steps remain required. No artifacts are deleted and no billing, quota or gate suppression is performed. Runtime and full dependency audits are explicit failing gates; other functional checks still execute after another step fails, without converting failures to success.

Readable DOM, accessibility, focus traces, network, exact source identity, test results and audit evidence are additionally preserved in existing private CI job logs. A proposed encoded screenshot-log fallback was blocked by the tool and was not committed or substituted through another path. Screenshot files remain subject to the artifact quota and must not be described as retrieved or visually inspected when upload fails. Final exact-head results and remaining blockers belong in PR45, not inferred from this document.

PR42's qualified head and migration-preparation reference stay `4e55ece88cb0afcc3e85c8f0436f8d346f5c40a1`. PR44 was read-only checked at `d1e85f458b97ded119d1bec0e89539a9f3cea8c1` and not imported or changed. No merge, deployment, production/hosted database access, maintenance change or migration-preparation artifact modification is authorized or performed by this continuation. The existing exact-branch deployment deny rule remains unchanged.

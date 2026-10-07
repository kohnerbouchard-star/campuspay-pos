# PR45 browser continuation — 2026-10-07

Continue the existing branch and PR45, not PR42 or checkout PR44. The starting remote head was verified as `7ee06e52bd1d785fcd0363b94a68e3dd644659d0`.

## Observed cause before correction

Diagnostic-only commit `0121d67782d73fefd1648e6015e10609ce451093` kept the failing suite unchanged. In [run 37554566631, UI job 112577706390](https://github.com/kohnerbouchard-star/campuspay-pos/actions/runs/37554566631/job/112577706390), the real rendered fixture showed:

- No browser console messages, page errors or failed requests. HTML, JavaScript, CSS and the synthetic roster GET all returned 200. The roster row was rendered.
- The select exists with one accessible role/name: `combobox "Student Year"`. The exact role-based locator matched one element.
- The enclosing label's descendant text is `Student YearAll yearsY1Y2Y3Y4Y5Y6Y7Y8Y9Y10Y11Y12Y13`. The exact label-text locator matched zero elements. Waiting longer cannot fix this semantic mismatch.
- The fixture served text without a charset: its actual DOM showed `MICA Money Â· E202` and `1â€“1 of 1`. Its missing UTF-8 declaration would break the exact dialog-name and pagination assertions after the label was fixed.

## Correction

The suite uses exact combobox roles/names for Student Year and the identically wrapped Preset select. It additionally checks unique matches, exact accessible names, the 14 year options, and the real UTF-8 eyebrow. Both fixture servers explicitly serve HTML/JavaScript/CSS as UTF-8 and declare a meta charset. Every existing selection, layout, focus, list state, access save/recovery, readiness race, draft protection and zero-mutation assertion is retained. The 12-second action timeout is unchanged. Failure output includes DOM, accessibility, bounded console/network diagnostics and a screenshot.

The correction does not alter application components, server authorization, financial endpoints, dependencies or migrations. The real-component fixture remains outside application routes; all requests remain synthetic and loopback-only. Native authorization and financial tests are separate.

## Evidence and non-waived failures

Original artifact upload steps remain required. No artifacts are deleted and no billing, quota or gate suppression is performed. Runtime and full dependency audits are explicit failing gates; other functional checks still execute after another step fails, without converting failures to success.

Readable DOM, accessibility, network, exact source identity, test results and audit evidence are additionally preserved in the existing private CI job logs. A proposed encoded screenshot-log fallback was blocked by the tool and was not committed or substituted through another path. Screenshot files remain subject to the artifact quota and must not be described as retrieved or visually inspected when upload fails. Final exact-head results and remaining blockers belong in PR45, not inferred from this document.

PR42's qualified head and migration-preparation reference stay `4e55ece88cb0afcc3e85c8f0436f8d346f5c40a1`. PR44 was read-only checked at `d1e85f458b97ded119d1bec0e89539a9f3cea8c1` and not imported or changed. No merge, deployment, production/hosted database access, maintenance change or migration-preparation artifact modification is authorized or performed by this continuation. The existing exact-branch deployment deny rule remains unchanged.

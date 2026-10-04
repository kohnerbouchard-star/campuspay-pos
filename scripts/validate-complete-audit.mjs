#!/usr/bin/env node
import fs from 'node:fs'

const report = JSON.parse(fs.readFileSync('.validation/dependency-audit.json', 'utf8'))
if (report?.error || !Object.hasOwn(report ?? {}, 'vulnerabilities') || typeof report.vulnerabilities !== 'object' || report.vulnerabilities === null
  || typeof report.metadata !== 'object' || report.metadata === null || typeof report.metadata.vulnerabilities !== 'object' || report.metadata.vulnerabilities === null) {
  console.error('Complete dependency audit report is incomplete or contains an audit-endpoint error.')
  process.exit(1)
}
const vulnerabilities = report.vulnerabilities
const names = Object.keys(vulnerabilities).sort()

if (names.length === 0) {
  const counts = report.metadata.vulnerabilities
  if (Object.values(counts).some(value => typeof value !== 'number') || (counts.total ?? 0) !== 0) {
    console.error('Complete dependency audit metadata is inconsistent with an empty vulnerability set.')
    process.exit(1)
  }
  console.log('Complete dependency audit passed with no known vulnerabilities.')
  process.exit(0)
}

const allowed = ['@next/eslint-plugin-next', 'braces', 'eslint-config-next', 'fast-glob', 'micromatch'].sort()
const braces = vulnerabilities.braces
const advisory = Array.isArray(braces?.via) ? braces.via.find(value => typeof value === 'object' && value) : null
const exactChain = JSON.stringify(names) === JSON.stringify(allowed)
const exactAdvisory = advisory?.url === 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'
  && advisory?.source === 1240992
  && advisory?.severity === 'high'
const counts = report.metadata?.vulnerabilities ?? {}
const onlyKnownHigh = counts.critical === 0 && counts.high === 5 && counts.total === 5
const expiresAt = Date.parse('2026-11-01T00:00:00Z')

if (exactChain && exactAdvisory && onlyKnownHigh && Date.now() < expiresAt) {
  console.warn('Temporary development-only exception: GHSA-vfj7-8cjw-p6xm currently has no patched braces release. Runtime dependencies are separately audited with --omit=dev. This exact exception expires 2026-11-01 and fails closed on any package/advisory drift.')
  process.exit(0)
}

console.error('Complete dependency audit contains a non-exempt high/critical finding, changed dependency chain, or expired exception.')
console.error(JSON.stringify({ names, counts, advisory: advisory?.url ?? null }, null, 2))
process.exit(1)

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
const exactChain = JSON.stringify(names) === JSON.stringify(allowed)
const expectedFix = { name: 'eslint-config-next', version: '14.2.35', isSemVerMajor: true }
const descriptors = {
  '@next/eslint-plugin-next': { severity: 'high', isDirect: false, via: ['fast-glob'], effects: ['eslint-config-next'], range: '>=14.3.0-canary.0', node: 'node_modules/@next/eslint-plugin-next' },
  braces: { severity: 'high', isDirect: false, via: null, effects: ['micromatch'], range: '*', node: 'node_modules/braces' },
  'eslint-config-next': { severity: 'high', isDirect: true, via: ['@next/eslint-plugin-next'], effects: [], range: '>=14.3.0-canary.0', node: 'node_modules/eslint-config-next' },
  'fast-glob': { severity: 'high', isDirect: false, via: ['micromatch'], effects: ['@next/eslint-plugin-next'], range: '*', node: 'node_modules/fast-glob' },
  micromatch: { severity: 'high', isDirect: false, via: ['braces'], effects: ['fast-glob'], range: '>=0.2.0', node: 'node_modules/micromatch' },
}
const exactFixState = value => value && typeof value === 'object' && !Array.isArray(value)
  && Object.keys(value).sort().join(',') === 'isSemVerMajor,name,version'
  && value.name === expectedFix.name && value.version === expectedFix.version && value.isSemVerMajor === true
const exactStringArray = (actual, expected) => Array.isArray(actual) && JSON.stringify(actual) === JSON.stringify(expected)
const bracesVia = vulnerabilities.braces?.via
const advisory = Array.isArray(bracesVia) && bracesVia.length === 1 && typeof bracesVia[0] === 'object' && bracesVia[0] ? bracesVia[0] : null
const exactAdvisory = advisory?.url === 'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'
  && advisory?.source === 1240992
  && advisory?.name === 'braces'
  && advisory?.dependency === 'braces'
  && advisory?.severity === 'high'
  && advisory?.range === '<=3.0.3'
  && exactStringArray(advisory?.cwe, ['CWE-674'])
  && advisory?.cvss?.score === 7.5
  && advisory?.cvss?.vectorString === 'CVSS:3.1/AV:N/AC:L/PR:N/UI:N/S:U/C:N/I:N/A:H'
const exactPackages = exactChain && allowed.every(name => {
  const actual = vulnerabilities[name]
  const expected = descriptors[name]
  if (!actual || actual.name !== name || actual.severity !== expected.severity || actual.isDirect !== expected.isDirect
    || actual.range !== expected.range || !exactStringArray(actual.effects, expected.effects)
    || !exactStringArray(actual.nodes, [expected.node]) || !exactFixState(actual.fixAvailable)) return false
  return name === 'braces' ? exactAdvisory : exactStringArray(actual.via, expected.via)
})
const counts = report.metadata?.vulnerabilities ?? {}
const onlyKnownHigh = counts.info === 0 && counts.low === 0 && counts.moderate === 0 && counts.critical === 0
  && counts.high === 5 && counts.total === 5
const expiresAt = Date.parse('2026-11-01T00:00:00Z')

if (exactPackages && onlyKnownHigh && Date.now() < expiresAt) {
  console.warn('Temporary development-only exception: GHSA-vfj7-8cjw-p6xm currently has no non-breaking patched path in this lint dependency chain. Runtime dependencies are separately audited with --omit=dev. This exact advisory graph and fix state are pinned through 2026-11-01 and fail closed on any drift.')
  process.exit(0)
}

console.error('Complete dependency audit contains a non-exempt high/critical finding, changed dependency chain, or expired exception.')
console.error(JSON.stringify({ names, counts, advisory: advisory?.url ?? null, exactPackages }, null, 2))
process.exit(1)

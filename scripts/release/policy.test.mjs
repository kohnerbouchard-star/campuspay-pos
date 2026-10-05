import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawnSync } from 'node:child_process'
import { checkInvocation, checkEnvironment, checkApproval, checkPriorEvidence, checkDatabaseUrl, checkHistory, checkFiles, checkArtifact, checkBackupPolicy, policy, versions } from './policy.mjs'
import { githubGate } from './github.mjs'
import { checkVercelState, checkCurrentAlias, verifyVercelHold } from './vercel.mjs'

const env = { GITHUB_ACTIONS: 'true', GITHUB_REPOSITORY: policy.repository, GITHUB_EVENT_NAME: 'workflow_dispatch', GITHUB_REF: 'refs/heads/main',
  GITHUB_WORKFLOW_REF: `${policy.repository}/.github/workflows/campuspay-release.yml@refs/heads/main`, GITHUB_SHA: 'a'.repeat(40), GITHUB_WORKFLOW_SHA: 'a'.repeat(40),
  GITHUB_RUN_ATTEMPT: '1', GITHUB_RUN_ID: '123', RELEASE_MODE: 'preflight' }
const protectedEnvironment = name => ({ id: 1, name, can_admins_bypass: false,
  protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: policy.reviewerId, login: policy.reviewerLogin } }] }],
  deployment_branch_policy: { protected_branches: false, custom_branch_policies: true } })
const branches = { total_count: 1, branch_policies: [{ name: 'main', type: 'branch' }] }
const db = `postgresql://campuspay_owner:synthetic@${policy.databaseHost}/campuspay?sslmode=verify-full`

test('manual main only; refuses forks, arbitrary refs, workflow code and reruns', () => {
  checkInvocation(env)
  for (const [key, value] of Object.entries({ GITHUB_ACTIONS: 'false', GITHUB_REPOSITORY: 'other/repo', GITHUB_EVENT_NAME: 'push',
    GITHUB_REF: 'refs/tags/main', GITHUB_WORKFLOW_REF: 'untrusted', GITHUB_SHA: 'invalid', GITHUB_WORKFLOW_SHA: 'b'.repeat(40), GITHUB_RUN_ATTEMPT: '2', GITHUB_RUN_ID: 'x', RELEASE_MODE: 'apply-all' })) {
    assert.throws(() => checkInvocation({ ...env, [key]: value }))
  }
  const release = { ...env, RELEASE_MODE: 'release', DEPLOYMENT_ID: 'dpl_abc', EVIDENCE_RUN_ID: '122', MAINTENANCE_CONFIRMATION: 'ALL_CAMPUSPAY_WRITERS_STOPPED_AND_RECOVERY_RESOLVED' }
  checkInvocation(release)
  for (const key of ['DEPLOYMENT_ID', 'EVIDENCE_RUN_ID', 'MAINTENANCE_CONFIRMATION']) assert.throws(() => checkInvocation({ ...release, [key]: '' }))
  assert.throws(() => checkInvocation({ ...release, EVIDENCE_RUN_ID: '123' }))
})

test('actual CLI refuses an untrusted ref before network/DB work without leaking step secrets', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-cli-boundary-'))
  const sentinel = 'SYNTHETIC_SECRET_MUST_NEVER_APPEAR'
  const attempted = path.join(directory, 'attempted')
  const preload = path.join(directory, 'boundary.mjs')
  try {
    fs.writeFileSync(preload, `import fs from 'node:fs'; import net from 'node:net';
      const refused = () => { fs.writeFileSync(${JSON.stringify(attempted)}, 'network'); throw new Error('forbidden'); };
      globalThis.fetch = refused; net.Socket.prototype.connect = refused;`)
    const result = spawnSync(process.execPath, ['--import', preload, 'scripts/release/cli.mjs', 'gate'], {
      encoding: 'utf8', env: { ...process.env, ...env, GITHUB_REF: 'refs/heads/untrusted', GITHUB_TOKEN: sentinel,
        CAMPUSPAY_OWNER_URL: sentinel, CAMPUSPAY_BACKUP_KEY: sentinel, VERCEL_READ_TOKEN: sentinel,
        GITHUB_STEP_SUMMARY: path.join(directory, 'summary') },
    })
    assert.equal(result.status, 1)
    assert.match(result.stderr, /UNTRUSTED_WORKFLOW_INVOCATION/)
    assert.equal(fs.existsSync(attempted), false)
    assert.equal((result.stdout + result.stderr + fs.readFileSync(path.join(directory, 'summary'), 'utf8')).includes(sentinel), false)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('requires exact reviewer, no admin bypass and exactly main branch (not tag)', () => {
  const environment = protectedEnvironment('campuspay-production')
  checkEnvironment(environment, branches, environment.name)
  for (const patch of [{ id: undefined }, { id: 0 }, { can_admins_bypass: true }, { can_admins_bypass: undefined }, { protection_rules: [] }, { deployment_branch_policy: null },
    { protection_rules: [{ type: 'required_reviewers', reviewers: [{ type: 'User', reviewer: { id: 2, login: 'stranger' } }] }] }]) {
    assert.throws(() => checkEnvironment({ ...environment, ...patch }, branches, environment.name))
  }
  for (const alternative of [{ total_count: 0 }, { total_count: 2, branch_policies: [...branches.branch_policies, { name: '*', type: 'branch' }] },
    { total_count: 1, branch_policies: [{ name: 'main', type: 'tag' }] }, { total_count: 1, branch_policies: [{ name: '*', type: 'branch' }] }]) {
    assert.throws(() => checkEnvironment(environment, alternative, environment.name))
  }
})

test('protection alone does not count as action-time approval; rejects absent, foreign, rejected and ambiguous reviews', () => {
  const environment = protectedEnvironment('campuspay-production')
  const review = { state: 'approved', environments: [environment], user: { id: policy.reviewerId, login: policy.reviewerLogin } }
  checkApproval([review], environment)
  for (const reviews of [[], [{ ...review, state: 'rejected' }], [{ ...review, user: { id: 9, login: 'stranger' } }],
    [{ ...review, environments: [{ ...environment, id: 9 }] }], [review, review]]) assert.throws(() => checkApproval(reviews, environment))
})

test('database URL enforces owner, direct host, database, verified TLS and no overrides', () => {
  checkDatabaseUrl(db)
  for (const invalid of ['not-a-url', db.replace(policy.databaseHost, 'localhost'), db.replace('campuspay?', 'postgres?'),
    db.replace('campuspay_owner:', 'campuspay_runtime_login:'), db.replace('verify-full', 'require'), db + '&host=evil',
    db + '&sslmode=disable', db + '#fragment', db.replace('.c-3.', '-pooler.c-3.'), db.replace('/campuspay?', ':6432/campuspay?'),
    db.replace(':synthetic@', '@')]) assert.throws(() => checkDatabaseUrl(invalid))
})

test('cutover evidence is bound to the successful release run, tooling SHA, age and exact deployment', () => {
  const now = Date.now()
  const invocation = { ...env, RELEASE_MODE: 'verify-cutover', EVIDENCE_RUN_ID: '122', DEPLOYMENT_ID: 'dpl_abc' }
  const previous = { head_sha: env.GITHUB_SHA, head_branch: 'main', run_attempt: 1, event: 'workflow_dispatch',
    path: '.github/workflows/campuspay-release.yml', status: 'completed', conclusion: 'success', updated_at: new Date(now - 60000).toISOString() }
  const artifacts = { artifacts: [{ name: 'release-passed-122-dpl_abc', expired: false }] }
  checkPriorEvidence(previous, artifacts, invocation, now)
  for (const patch of [{ head_sha: 'b'.repeat(40) }, { head_branch: 'attacker' }, { run_attempt: 2 }, { event: 'push' },
    { path: '.github/workflows/other.yml' }, { status: 'in_progress' }, { conclusion: 'failure' },
    { updated_at: new Date(now - 86400001).toISOString() }, { updated_at: new Date(now + 1).toISOString() }]) {
    assert.throws(() => checkPriorEvidence({ ...previous, ...patch }, artifacts, invocation, now))
  }
  for (const patch of [{ EVIDENCE_RUN_ID: '121' }, { DEPLOYMENT_ID: 'dpl_differentBuildOfSameCommit' }, { RELEASE_MODE: 'release' }]) {
    assert.throws(() => checkPriorEvidence(previous, artifacts, { ...invocation, ...patch }, now))
  }
  assert.throws(() => checkPriorEvidence(previous, { artifacts: [{ ...artifacts.artifacts[0], expired: true }] }, invocation, now))
  assert.throws(() => checkPriorEvidence(previous, { artifacts: [{ name: 'release-passed-122', expired: false }] }, invocation, now))
  checkPriorEvidence(previous, { artifacts: [{ name: 'preflight-passed-122', expired: false }] }, { ...invocation, RELEASE_MODE: 'release' }, now)
})

test('history must be exact 32 + five: no gaps, unknown/reserved044, partial resumption or duplicate apply', () => {
  const baseline = versions(policy.baseline), pending = versions(policy.pending)
  checkHistory(baseline, pending)
  checkHistory([...baseline, ...pending], [], true)
  for (const [a, p] of [[baseline.slice(1), pending], [[...baseline, '20261004090100_reserved044'], pending],
    [[...baseline, pending[0]], pending.slice(1)], [[...baseline, ...pending], []], [baseline, [...pending, 'future']]]) assert.throws(() => checkHistory(a, p))
  assert.throws(() => checkHistory(baseline, pending, true))
})

test('migration manifest rejects missing/extra/changed files before connection', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cp-release-files-'))
  try {
    assert.throws(() => checkFiles(directory))
    for (const row of [...policy.baseline, ...policy.pending]) fs.writeFileSync(path.join(directory, `${row.version}.sql`), 'select 1;')
    assert.throws(() => checkFiles(directory), /MIGRATION_FILES_CHANGED/)
  } finally { fs.rmSync(directory, { recursive: true, force: true }) }
})

test('backup destination requires explicit policy; retained artifact bound to run, SHA, digest and actual retention', () => {
  checkBackupPolicy(policy.backupPolicy)
  for (const value of ['', undefined, 'approved', policy.backupPolicy.replace('90-days', '7-days')]) assert.throws(() => checkBackupPolicy(value))
  const now = Date.now(), digest = 'b'.repeat(64)
  const args = { runId: 123, toolingSha: env.GITHUB_SHA, digest, name: 'backup', now }
  const artifact = { id: 9, name: 'backup', expired: false, workflow_run: { id: 123, head_sha: env.GITHUB_SHA }, digest: `sha256:${digest}`,
    size_in_bytes: 512, expires_at: new Date(now + 90 * 86400000).toISOString() }
  checkArtifact(artifact, args)
  for (const patch of [{ id: 0 }, { name: 'other' }, { expired: true }, { digest: 'sha256:' + 'c'.repeat(64) }, { size_in_bytes: 0 },
    { workflow_run: { id: 122, head_sha: env.GITHUB_SHA } }, { workflow_run: { id: 123, head_sha: 'bad' } },
    { expires_at: new Date(now + 7 * 86400000).toISOString() }, { expires_at: 'invalid' }]) assert.throws(() => checkArtifact({ ...artifact, ...patch }, args))
})

const project = { id: policy.vercelProject, accountId: policy.vercelTeam, name: 'campuspay-pos', paused: true, autoAssignCustomDomains: false, targets: { production: { id: 'dpl_abc' } } }
const deployment = { id: 'dpl_abc', projectId: policy.vercelProject, team: { id: policy.vercelTeam }, readyState: 'READY', target: 'production',
  gitSource: { sha: policy.candidate, type: 'github' }, alias: policy.origins.map(o => new URL(o).hostname) }
test('only paused exact project, production build and qualified SHA; verification requires exact target', () => {
  checkVercelState(project, deployment, 'dpl_abc', true)
  for (const patch of [{ id: 'other' }, { accountId: 'other' }, { paused: false }, { autoAssignCustomDomains: true }]) assert.throws(() => checkVercelState({ ...project, ...patch }, deployment, 'dpl_abc'))
  for (const patch of [{ projectId: 'other' }, { team: { id: 'other' } }, { target: 'preview' }, { readyState: 'BUILDING' }, { gitSource: { sha: 'new', type: 'github' } }]) assert.throws(() => checkVercelState(project, { ...deployment, ...patch }, 'dpl_abc'))
  assert.throws(() => checkVercelState({ ...project, targets: {} }, deployment, 'dpl_abc', true))
})

test('current alias ownership and targets required; a historical deployment alias list is insufficient', () => {
  const hostname = new URL(policy.origins[0]).hostname
  const alias = { alias: hostname, projectId: policy.vercelProject, deploymentId: 'dpl_abc', deletedAt: null, redirect: null }
  checkCurrentAlias(alias, hostname, 'dpl_abc', true)
  checkCurrentAlias({ ...alias, deploymentId: 'dpl_old' }, hostname, 'dpl_abc', false)
  assert.throws(() => checkCurrentAlias({ ...alias, deploymentId: 'dpl_old' }, hostname, 'dpl_abc', true))
  for (const patch of [{ alias: 'another.vercel.app' }, { projectId: 'prj_another' }, { deploymentId: null }, { deletedAt: 1 },
    { redirect: 'https://other.invalid' }, { microfrontends: { applications: [] } }]) assert.throws(() => checkCurrentAlias({ ...alias, ...patch }, hostname, 'dpl_abc'))
})

test('Vercel denial stops immediately; origin probes carry no token and no redirects', async () => {
  const urls = []
  await assert.rejects(verifyVercelHold({ token: 'synthetic', deploymentId: 'dpl_abc', request: async url => { urls.push(url); return new Response('', { status: 403 }) } }), /VERCEL_ACCESS_DENIED/)
  assert.equal(urls.length, 1)
  const request = async (url, options) => {
    if (url.includes('/projects/')) return Response.json(project)
    if (url.includes('/deployments/')) return Response.json(deployment)
    if (url.includes('/aliases/')) return Response.json({ alias: new URL(url).pathname.split('/').at(-1), projectId: policy.vercelProject, deploymentId: 'dpl_abc' })
    assert.equal(options.headers, undefined)
    assert.equal(options.redirect, 'manual')
    return new Response(null, { status: 503, headers: { 'x-vercel-error': 'DEPLOYMENT_PAUSED' } })
  }
  await verifyVercelHold({ token: 'synthetic', deploymentId: 'dpl_abc', request })
  await assert.rejects(verifyVercelHold({ token: 'synthetic', deploymentId: 'dpl_abc', completed: true,
    request: (url, options) => url.includes('/aliases/') ? Promise.resolve(Response.json({ alias: new URL(url).pathname.split('/').at(-1),
      projectId: policy.vercelProject, deploymentId: 'dpl_old' })) : request(url, options) }), /MATCHING_PRODUCTION_ALIAS/)
  await assert.rejects(verifyVercelHold({ token: 'synthetic', deploymentId: 'dpl_abc', request: (url, options) => url.startsWith('https://api.vercel.com') ? request(url, options) : Promise.resolve(new Response(null, { status: 302 })) }))
})

test('GitHub gate checks exact main and candidate CI before environments; API failures never fall back', async () => {
  const calls = []
  const get = async suffix => {
    calls.push(suffix)
    if (suffix === '') return { full_name: policy.repository, private: true, default_branch: 'main' }
    if (suffix === '/git/ref/heads/main') return { object: { sha: env.GITHUB_SHA } }
    if (suffix.startsWith('/actions/workflows/')) return { workflow_runs: [{ head_sha: env.GITHUB_SHA, head_branch: 'main', event: 'push', path: `.github/workflows/${suffix.split('/')[3]}`, status: 'completed', conclusion: 'success' }] }
    if (suffix.startsWith('/actions/runs/')) return { head_sha: policy.candidate, status: 'completed', conclusion: 'success', path: `.github/workflows/${suffix.endsWith(String(policy.ciRuns[0])) ? 'validate' : 'access-validation'}.yml` }
    if (suffix.includes('/deployment-branch-policies')) return branches
    if (suffix.startsWith('/environments/')) return protectedEnvironment(suffix.split('/')[2])
    throw new Error('UNEXPECTED_API')
  }
  await githubGate({ env, get })
  assert.equal(calls.filter(c => c.startsWith('/environments/')).length, 6)
  for (const refused of ['/git/ref/heads/main', `/actions/runs/${policy.ciRuns[0]}`, '/environments/campuspay-production']) {
    await assert.rejects(githubGate({ env, get: suffix => suffix === refused ? Promise.resolve({}) : get(suffix) }))
  }
  await assert.rejects(githubGate({ env, get: async () => { throw new Error('403') } }), /403/)
})

import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const policy = JSON.parse(fs.readFileSync(new URL('./candidate.json', import.meta.url), 'utf8'))
export class GateError extends Error {}
export function requireThat(condition, code) { if (!condition) throw new GateError(code) }
export const same = (a, b) => JSON.stringify(a) === JSON.stringify(b)
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
export const versions = rows => rows.map(row => row.version)
export const environments = ['campuspay-preflight', 'campuspay-backup', 'campuspay-production']

export function checkInvocation(env) {
  requireThat(env.GITHUB_ACTIONS === 'true' && env.GITHUB_REPOSITORY === policy.repository &&
    env.GITHUB_EVENT_NAME === 'workflow_dispatch' && env.GITHUB_REF === 'refs/heads/main' &&
    env.GITHUB_WORKFLOW_REF === `${policy.repository}/.github/workflows/campuspay-release.yml@refs/heads/main` &&
    /^[a-f0-9]{40}$/.test(env.GITHUB_SHA ?? '') && env.GITHUB_WORKFLOW_SHA === env.GITHUB_SHA &&
    env.GITHUB_RUN_ATTEMPT === '1' && /^\d+$/.test(env.GITHUB_RUN_ID ?? ''), 'UNTRUSTED_WORKFLOW_INVOCATION')
  requireThat(['preflight', 'release', 'verify-cutover'].includes(env.RELEASE_MODE), 'INVALID_RELEASE_MODE')
  if (env.RELEASE_MODE !== 'preflight') {
    requireThat(/^dpl_[A-Za-z0-9]+$/.test(env.DEPLOYMENT_ID ?? ''), 'EXACT_DEPLOYMENT_REQUIRED')
    requireThat(env.MAINTENANCE_CONFIRMATION === 'ALL_CAMPUSPAY_WRITERS_STOPPED_AND_RECOVERY_RESOLVED', 'MAINTENANCE_CONFIRMATION_REQUIRED')
    requireThat(/^\d+$/.test(env.EVIDENCE_RUN_ID ?? '') && env.EVIDENCE_RUN_ID !== env.GITHUB_RUN_ID, 'PRIOR_SUCCESSFUL_RUN_REQUIRED')
  }
}

export function checkEnvironment(environment, branchPolicies, name) {
  const reviewers = environment.protection_rules?.find(rule => rule.type === 'required_reviewers')?.reviewers
  requireThat(Number.isSafeInteger(environment.id) && environment.id > 0 && environment.name === name && environment.can_admins_bypass === false &&
    Array.isArray(reviewers) && reviewers.length === 1 && reviewers[0].type === 'User' &&
    reviewers[0].reviewer?.id === policy.reviewerId && reviewers[0].reviewer?.login === policy.reviewerLogin,
  'REQUIRED_REVIEWER_PROTECTION_MISSING')
  requireThat(environment.deployment_branch_policy?.protected_branches === false &&
    environment.deployment_branch_policy?.custom_branch_policies === true && branchPolicies.total_count === 1 &&
    branchPolicies.branch_policies?.length === 1 && branchPolicies.branch_policies[0].name === 'main' &&
    branchPolicies.branch_policies[0].type === 'branch', 'MAIN_ONLY_ENVIRONMENT_REQUIRED')
}

export function checkApproval(reviews, environment) {
  const relevant = reviews.filter(review => review.environments?.some(e => e.id === environment.id && e.name === environment.name))
  requireThat(relevant.length === 1 && relevant[0].state === 'approved' &&
    relevant[0].user?.id === policy.reviewerId && relevant[0].user?.login === policy.reviewerLogin,
  'ACTION_TIME_APPROVAL_MISSING')
}

export function checkPriorEvidence(previous, artifacts, env, now = Date.now()) {
  const age = now - Date.parse(previous.updated_at)
  requireThat(previous.head_sha === env.GITHUB_SHA && previous.head_branch === 'main' && previous.run_attempt === 1 &&
    previous.event === 'workflow_dispatch' && previous.path === '.github/workflows/campuspay-release.yml' &&
    previous.status === 'completed' && previous.conclusion === 'success' && age >= 0 && age < 24 * 3600000,
  'PRIOR_RUN_NOT_QUALIFIED')
  // The successful migration job publishes this exact deployment-bound name.
  // A different build of the same commit cannot inherit its cutover evidence.
  const name = env.RELEASE_MODE === 'release' ? `preflight-passed-${env.EVIDENCE_RUN_ID}` :
    `release-passed-${env.EVIDENCE_RUN_ID}-${env.DEPLOYMENT_ID}`
  requireThat(artifacts.artifacts?.some(a => a.name === name && a.expired === false), 'PRIOR_RUN_EVIDENCE_MISSING')
}

export function checkDatabaseUrl(value) {
  let url
  try { url = new URL(value) } catch { throw new Error('DATABASE_TARGET_INVALID') }
  requireThat(['postgres:', 'postgresql:'].includes(url.protocol) && url.hostname === policy.databaseHost &&
    (!url.port || url.port === '5432') && url.pathname === `/${policy.databaseName}` &&
    decodeURIComponent(url.username) === policy.ownerRole && Boolean(url.password) && !url.hash &&
    [...url.searchParams.keys()].length === 1 && url.searchParams.get('sslmode') === 'verify-full', 'DATABASE_TARGET_INVALID')
  return url
}

export function checkFiles(directory) {
  const expected = [...policy.baseline, ...policy.pending]
  requireThat(same(fs.readdirSync(directory).sort(), expected.map(row => `${row.version}.sql`)), 'MIGRATION_FILES_CHANGED')
  for (const row of expected) requireThat(sha256(fs.readFileSync(path.join(directory, `${row.version}.sql`))) === row.sha256, 'MIGRATION_FILES_CHANGED')
}

export function checkHistory(applied, pending, completed = false) {
  requireThat(same(applied, versions(completed ? [...policy.baseline, ...policy.pending] : policy.baseline)) &&
    same(pending, completed ? [] : versions(policy.pending)), 'EXACT_RELEASE_HISTORY_REQUIRED')
}

export function checkBackupPolicy(value) { requireThat(value === policy.backupPolicy, 'BACKUP_DESTINATION_NOT_APPROVED') }

export function checkArtifact(artifact, { runId, toolingSha, digest, name, now = Date.now() }) {
  const ttl = Date.parse(artifact.expires_at) - now
  requireThat(Number.isSafeInteger(artifact.id) && artifact.id > 0 && artifact.name === name &&
    artifact.expired === false && artifact.workflow_run?.id === Number(runId) &&
    artifact.workflow_run?.head_sha === toolingSha && artifact.digest === `sha256:${digest}` &&
    /^[a-f0-9]{64}$/.test(digest ?? '') && artifact.size_in_bytes > 0 && artifact.size_in_bytes < 70 * 1024 * 1024 &&
    ttl >= 89 * 86400000 && ttl <= 91 * 86400000, 'RETAINED_BACKUP_NOT_VERIFIED')
}

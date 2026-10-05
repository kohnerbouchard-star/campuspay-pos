import { checkApproval, checkEnvironment, checkInvocation, environments, policy, requireThat } from './policy.mjs'

export async function githubGet(suffix, env = process.env) {
  requireThat(Boolean(env.GITHUB_TOKEN), 'GITHUB_READ_TOKEN_REQUIRED')
  const response = await fetch(`https://api.github.com/repos/${policy.repository}${suffix}`, {
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
    redirect: 'error', signal: AbortSignal.timeout(20000),
  })
  requireThat(response.ok, 'GITHUB_READ_DENIED_OR_UNAVAILABLE')
  return response.json()
}

export async function githubGate({ env = process.env, get = suffix => githubGet(suffix, env), approved = [] } = {}) {
  checkInvocation(env)
  const repository = await get('')
  requireThat(repository.full_name === policy.repository && repository.private === true && repository.default_branch === 'main', 'REPOSITORY_POLICY_CHANGED')
  const main = await get('/git/ref/heads/main')
  requireThat(main.object?.sha === env.GITHUB_SHA, 'MAIN_CHANGED_REDISPATCH_REQUIRED')
  for (const workflow of ['validate', 'release-validation']) {
    const trusted = await get(`/actions/workflows/${workflow}.yml/runs?head_sha=${env.GITHUB_SHA}&event=push&per_page=100`)
    requireThat(trusted.workflow_runs?.some(run => run.head_sha === env.GITHUB_SHA && run.head_branch === 'main' &&
      run.event === 'push' && run.path === `.github/workflows/${workflow}.yml` && run.status === 'completed' && run.conclusion === 'success'), 'TOOLING_MAIN_CI_NOT_QUALIFIED')
  }
  for (const [index, id] of policy.ciRuns.entries()) {
    const run = await get(`/actions/runs/${id}`)
    requireThat(run.head_sha === policy.candidate && run.status === 'completed' && run.conclusion === 'success' &&
      run.path === `.github/workflows/${index === 0 ? 'validate' : 'access-validation'}.yml`, 'APPLICATION_CANDIDATE_NOT_QUALIFIED')
  }
  if (env.RELEASE_MODE !== 'preflight') {
    const previous = await get(`/actions/runs/${env.EVIDENCE_RUN_ID}`)
    const age = Date.now() - Date.parse(previous.updated_at)
    requireThat(previous.head_sha === env.GITHUB_SHA && previous.head_branch === 'main' && previous.run_attempt === 1 &&
      previous.event === 'workflow_dispatch' && previous.path === '.github/workflows/campuspay-release.yml' &&
      previous.conclusion === 'success' && age >= 0 && age < 24 * 3600000, 'PRIOR_RUN_NOT_QUALIFIED')
    const artifacts = await get(`/actions/runs/${env.EVIDENCE_RUN_ID}/artifacts?per_page=100`)
    const name = `${env.RELEASE_MODE === 'release' ? 'preflight-passed' : 'release-passed'}-${env.EVIDENCE_RUN_ID}`
    requireThat(artifacts.artifacts?.some(a => a.name === name && !a.expired), 'PRIOR_RUN_EVIDENCE_MISSING')
  }
  const reviews = approved.length ? await get(`/actions/runs/${env.GITHUB_RUN_ID}/approvals`) : []
  for (const name of environments) {
    const environment = await get(`/environments/${name}`)
    const branches = await get(`/environments/${name}/deployment-branch-policies?per_page=100`)
    checkEnvironment(environment, branches, name)
    if (approved.includes(name)) checkApproval(reviews, environment)
  }
}

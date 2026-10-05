import { policy, requireThat } from './policy.mjs'

export function checkVercelState(project, deployment, deploymentId, completed = false) {
  requireThat(project.id === policy.vercelProject && project.accountId === policy.vercelTeam &&
    project.name === 'campuspay-pos' && project.paused === true && project.autoAssignCustomDomains === false,
  'VERCEL_HOLD_NOT_VERIFIED')
  requireThat(deployment.id === deploymentId && deployment.projectId === policy.vercelProject &&
    deployment.team?.id === policy.vercelTeam && deployment.readyState === 'READY' && deployment.target === 'production' &&
    deployment.gitSource?.sha === policy.candidate && deployment.gitSource?.type === 'github', 'MATCHING_STAGED_APP_NOT_VERIFIED')
  if (completed) requireThat(project.targets?.production?.id === deploymentId &&
    policy.origins.every(origin => deployment.alias?.includes(new URL(origin).hostname)), 'MATCHING_PRODUCTION_ALIAS_NOT_VERIFIED')
}

// Read-only, exact project/team only. No fallback when access is denied, no
// deployment/pause/promotion/resume or environment-setting writes in this tool.
export async function verifyVercelHold({ token, deploymentId, completed = false, request = fetch }) {
  requireThat(Boolean(token), 'AUTHORIZED_VERCEL_READ_TOKEN_REQUIRED')
  const get = async path => {
    const response = await request(`https://api.vercel.com${path}`, { headers: { Authorization: `Bearer ${token}` }, redirect: 'error', signal: AbortSignal.timeout(20000) })
    requireThat(response.ok, 'VERCEL_ACCESS_DENIED_OR_UNAVAILABLE')
    return response.json()
  }
  requireThat(/^dpl_[A-Za-z0-9]+$/.test(deploymentId ?? ''), 'EXACT_DEPLOYMENT_REQUIRED')
  const project = await get(`/v9/projects/${policy.vercelProject}?teamId=${policy.vercelTeam}`)
  const deployment = await get(`/v13/deployments/${deploymentId}?teamId=${policy.vercelTeam}&withGitRepoInfo=true`)
  checkVercelState(project, deployment, deploymentId, completed)
  for (const origin of policy.origins) {
    const response = await request(origin, { redirect: 'manual', cache: 'no-store', signal: AbortSignal.timeout(20000) })
    requireThat(response.status === 503 && response.headers.get('x-vercel-error') === 'DEPLOYMENT_PAUSED', 'PUBLIC_TRAFFIC_HOLD_NOT_VERIFIED')
    await response.body?.cancel()
  }
}

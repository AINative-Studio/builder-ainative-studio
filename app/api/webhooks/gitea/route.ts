import { NextRequest, NextResponse } from 'next/server'
import { handlePRWebhook, type GiteaWebhookPayload } from '@/lib/git/committee-pr-gate'
import { deployCompanyFromGitea, companyDeployEnabled } from '@/lib/build/company-deploy'
import { resolveApp, setAppRailwayService } from '@/lib/build/app-registry'
import { BUILDER_WORKSPACE_ID } from '@/lib/build/instant-db'

/**
 * Gitea Webhook Handler — receives PR and push events from Gitea.
 *
 *  - Pull Request events run the committee gate (coding standards + multi-model
 *    review).
 *  - Push events (#392, follow-up deferred from #381) trigger a redeploy of an
 *    ALREADY-provisioned company's dedicated Railway service, so new commits
 *    landing on the default branch (e.g. #374's task-resolver merging a PR)
 *    actually reach the live site — today the only deploy trigger is a NEW paid
 *    checkout (#389), so a company never updates again after its first deploy.
 *
 * Configure in Gitea:
 *   URL: https://builder.ainative.studio/api/webhooks/gitea
 *   Secret: GITEA_WEBHOOK_SECRET
 *   Events: Pull Request (opened, synchronized, reopened), Push
 */

const WEBHOOK_SECRET = process.env.GITEA_WEBHOOK_SECRET || ''

/** The branch a push must land on to trigger a redeploy. Matches
 *  gitea-client.ts's fetchRepoFiles()/deployCompanyFromGitea()'s own default —
 *  the one branch this whole pipeline treats as "the deployable state". */
const DEPLOY_BRANCH = 'main'

export interface GiteaPushPayload {
  ref: string
  repository?: {
    name: string
    owner: { login: string }
  }
}

export interface PushRedeployResult {
  ok: boolean
  reason: string
}

/**
 * Handle a Gitea `push` webhook event: redeploy the company's dedicated
 * Railway service with the repo's new content.
 *
 * Deliberately narrow — this NEVER provisions a new company (no `railway add`
 * call ever originates here). A company only gets its first deploy via a real
 * paid checkout (#389); a routine push before that has happened is a normal,
 * silent no-op, not an error. Every branch returns a structured, honest
 * `{ok, reason}` — never throws — so the caller can fire this without
 * blocking or risking an unhandled rejection on the webhook response path.
 */
export async function handlePushRedeploy(payload: GiteaPushPayload): Promise<PushRedeployResult> {
  const { ref, repository } = payload

  if (ref !== `refs/heads/${DEPLOY_BRANCH}`) {
    return { ok: true, reason: `ignored_branch: ${ref}` }
  }
  if (!repository?.name || !repository.owner?.login) {
    return { ok: false, reason: 'invalid_payload' }
  }

  const slug = repository.name

  try {
    const entry = await resolveApp(slug)
    if (!entry) return { ok: true, reason: 'unknown_company' }
    if (!entry.railwayServiceId) return { ok: true, reason: 'not_yet_provisioned' }
    if (!companyDeployEnabled()) return { ok: true, reason: 'deploy_disabled' }

    const dep = await deployCompanyFromGitea(entry.workspaceId || BUILDER_WORKSPACE_ID, slug, true)
    if (dep.ok && dep.serviceName) {
      await setAppRailwayService(slug, {
        railwayServiceId: dep.serviceName,
        deployUrl: dep.url,
      }).catch(() => {})
      return { ok: true, reason: 'redeployed' }
    }
    return { ok: false, reason: dep.reason || 'deploy_failed' }
  } catch (err) {
    return { ok: false, reason: `error: ${err instanceof Error ? err.message : String(err)}` }
  }
}

function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true // Allow if no secret configured (dev mode)
  if (!signature) return false

  const crypto = require('crypto')
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')

  return `sha256=${expected}` === signature
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-gitea-signature') || ''
    const event = req.headers.get('x-gitea-event') || ''

    if (event !== 'pull_request' && event !== 'push') {
      return NextResponse.json({ ok: true, message: `Ignored event: ${event}` })
    }

    const body = await req.text()

    // Verify webhook signature
    if (!verifySignature(body, signature)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid signature' },
        { status: 401 }
      )
    }

    if (event === 'push') {
      // Fire-and-forget: Gitea expects a fast webhook response, and a real
      // redeploy (`railway up`) genuinely takes minutes (DEPLOY_TIMEOUT_MS in
      // company-deploy.ts is 300s) — never await it on the response path.
      // handlePushRedeploy() never throws (every branch returns a structured
      // result), so this .catch is a defensive backstop, not the primary
      // error path — logged, not surfaced to Gitea either way.
      const payload: GiteaPushPayload = JSON.parse(body)
      handlePushRedeploy(payload)
        .then((result) => {
          if (!result.ok) console.error('[gitea-webhook] push redeploy failed:', result.reason)
        })
        .catch((err) => console.error('[gitea-webhook] push redeploy threw:', err))

      return NextResponse.json({ ok: true, message: 'push accepted' })
    }

    const payload: GiteaWebhookPayload = JSON.parse(body)
    const result = await handlePRWebhook(payload)

    return NextResponse.json({
      ok: result.ok,
      verdict: result.verdict,
      summary: result.summary,
    })
  } catch (err) {
    console.error('[gitea-webhook] Error:', err)
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    service: 'gitea-webhook',
    status: 'ready',
    configured: Boolean(WEBHOOK_SECRET),
  })
}

/**
 * Per-company deploy orchestration (#381) — the real mechanism that takes a
 * company's Gitea repo content and gets it running on a dedicated Railway
 * service.
 *
 * Confirmed live, end-to-end, this session (see #381's GitHub comments for
 * the verification trail): Railway's own CLI build system, via
 *   1. `railway add --service <name> --json`   — create the (empty) service once
 *   2. `railway up <dir> --service <name> --json --detach` — build + deploy content
 * NOT the GraphQL `serviceCreate`-from-image flow `railway-deploy.ts` already
 * has (that assumes a single shared source image/repo — the wrong shape for
 * "each company deploys its OWN code"). Step 2 doubles as the redeploy
 * mechanism: re-running it with fresh content is how an update ships.
 *
 * COST SAFETY: mirrors railwayDeployEnabled()'s existing gate philosophy —
 * this module is INERT unless explicitly enabled, so it never creates a
 * billable Railway resource by accident (tests, CI, an unconfigured env).
 *
 * Deliberately decoupled from Gitea: this module only knows about a FileMap
 * (matches gitea-client.ts's fetchRepoFiles return shape and coverage-runner.
 * ts's convention) plus the scaffold from company-scaffold.ts. Fetching a
 * company's repo state is the CALLER's job.
 */

import { spawn } from 'child_process'
import { promises as fs } from 'fs'
import { writeFileMapToTemp, type FileMap } from './coverage-runner'
import { generateCompanyScaffold, hasDeployableEntrypoint } from './company-scaffold'
import { serviceNameForSlug } from './railway-deploy'
import { fetchRepoFiles, orgNameForWorkspace } from '@/lib/git/gitea-client'

export interface CompanyDeployResult {
  ok: boolean
  serviceName?: string
  url?: string
  reason?: string
}

/** Reasonable ceiling for `railway up`'s build+deploy round trip — a real
 *  Next.js build (npm install + next build) genuinely needs minutes, not
 *  seconds; mirrors coverage-runner.ts's philosophy of a generous but finite
 *  bound rather than an unbounded hang. */
export const DEPLOY_TIMEOUT_MS = 300_000

/** Whether this module is allowed to actually invoke the Railway CLI.
 *  Deliberately separate from railwayDeployEnabled() in railway-deploy.ts —
 *  that gate is scoped to the OLD shared-image GraphQL flow (still checks
 *  RAILWAY_COMPANY_SOURCE_IMAGE/_REPO, which this module doesn't use). This
 *  flow only needs RAILWAY_DEPLOY_ENABLED itself; the `railway` CLI's own
 *  session auth (not an env-var token) is what authorizes the actual calls. */
export function companyDeployEnabled(): boolean {
  return process.env.RAILWAY_DEPLOY_ENABLED === 'true'
}

function runCli(
  args: string[],
  cwd: string | undefined,
  timeoutMs: number,
): Promise<{ exitCode: number | null; timedOut: boolean; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn('railway', args, { cwd, shell: false })
    let stdout = ''
    let stderr = ''
    let timedOut = false
    const timer = setTimeout(() => {
      timedOut = true
      child.kill('SIGKILL')
    }, timeoutMs)
    child.stdout.on('data', (d) => { stdout += d.toString() })
    child.stderr.on('data', (d) => { stderr += d.toString() })
    child.on('close', (code) => {
      clearTimeout(timer)
      resolve({ exitCode: code, timedOut, stdout, stderr })
    })
    child.on('error', () => {
      clearTimeout(timer)
      resolve({ exitCode: null, timedOut, stdout, stderr })
    })
  })
}

/** Extract the last JSON object printed to stdout — `railway ... --json`
 *  still writes plain-text warnings (e.g. the Config-as-Code deprecation
 *  notice seen throughout this session) ahead of the actual JSON payload, so
 *  a naive `JSON.parse(stdout)` fails on real CLI output. PURE. */
export function parseLastJsonLine(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split('\n').map((l) => l.trim()).filter(Boolean)
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i])
      if (parsed && typeof parsed === 'object') return parsed
    } catch {
      continue
    }
  }
  return null
}

/**
 * Resolve (creating if needed) the public *.up.railway.app domain for a
 * service. `railway up --json` returns only `{deploymentId, logsUrl}` —
 * confirmed against real CLI output this session — never a public URL, so
 * getting one is always this SEPARATE `railway domain` call. Best-effort:
 * a domain-mint failure must not fail an otherwise-successful deploy.
 */
async function ensureServiceDomain(serviceName: string): Promise<string | undefined> {
  const result = await runCli(['domain', '--service', serviceName, '--json'], undefined, 30_000)
  if (result.exitCode !== 0) return undefined
  const parsed = parseLastJsonLine(result.stdout)
  const domain = parsed?.domain
  return typeof domain === 'string' && domain ? `https://${domain}` : undefined
}

/**
 * Ensure a dedicated Railway service exists for this company, creating it
 * (empty) if this is the first deploy. Idempotent: a second call for an
 * already-created service reuses it rather than erroring — `railway add`
 * itself would create a DUPLICATE service on every call, so the caller's
 * persisted railwayServiceId (or absence of one) is what this function
 * trusts, mirroring ensureCompanyService()'s existing idempotency contract
 * in railway-deploy.ts.
 */
async function ensureEmptyService(slug: string, alreadyProvisioned: boolean): Promise<{ ok: boolean; reason?: string }> {
  if (alreadyProvisioned) return { ok: true }
  const name = serviceNameForSlug(slug)
  const result = await runCli(['add', '--service', name, '--variables', `COMPANY_SLUG=${slug}`, '--json'], undefined, 60_000)
  if (result.exitCode !== 0) {
    return { ok: false, reason: result.timedOut ? 'railway add timed out' : `railway add failed: ${result.stderr.slice(0, 300)}` }
  }
  const parsed = parseLastJsonLine(result.stdout)
  if (!parsed || !parsed.id) {
    return { ok: false, reason: `railway add produced no service id: ${result.stdout.slice(0, 200)}` }
  }
  return { ok: true }
}

/**
 * Deploy (or redeploy) a company's generated app to its dedicated Railway
 * service. Scaffolds any missing project files, materializes to a temp
 * directory, then builds + deploys via the real, verified `railway up`
 * mechanism.
 *
 * @param slug              company brand slug — drives the deterministic
 *                          service name (serviceNameForSlug, shared with the
 *                          existing GraphQL flow so both paths agree on naming)
 * @param files             the company's current generated FileMap
 *                          (gitea-client.ts's fetchRepoFiles shape)
 * @param alreadyProvisioned true when the caller already has a persisted
 *                          railwayServiceId for this company — skips
 *                          `railway add` and goes straight to `railway up`
 */
export async function deployCompanyApp(
  slug: string,
  files: FileMap,
  alreadyProvisioned = false,
): Promise<CompanyDeployResult> {
  if (!companyDeployEnabled()) {
    return { ok: false, reason: 'disabled' }
  }
  const safeSlug = String(slug || '').replace(/[^a-z0-9_-]/gi, '').slice(0, 40).toLowerCase()
  if (!safeSlug) return { ok: false, reason: 'bad_slug' }

  if (!hasDeployableEntrypoint(files)) {
    return { ok: false, reason: 'no_app_entrypoint' }
  }

  const serviceName = serviceNameForSlug(safeSlug)
  const ensured = await ensureEmptyService(safeSlug, alreadyProvisioned)
  if (!ensured.ok) return { ok: false, reason: ensured.reason }

  const scaffolded = generateCompanyScaffold(files)

  let dir: string | null = null
  try {
    dir = await writeFileMapToTemp(scaffolded)

    const up = await runCli(
      ['up', dir, '--service', serviceName, '--detach', '--json'],
      undefined,
      DEPLOY_TIMEOUT_MS,
    )
    if (up.exitCode !== 0) {
      return {
        ok: false,
        serviceName,
        reason: up.timedOut
          ? `railway up timed out after ${DEPLOY_TIMEOUT_MS}ms`
          : `railway up failed: ${up.stderr.slice(0, 300) || up.stdout.slice(0, 300)}`,
      }
    }
    const parsed = parseLastJsonLine(up.stdout)
    if (!parsed || !parsed.deploymentId) {
      return { ok: false, serviceName, reason: `railway up produced no parseable deployment: ${up.stdout.slice(0, 200)}` }
    }

    return {
      ok: true,
      serviceName,
      url: await ensureServiceDomain(serviceName),
    }
  } finally {
    if (dir) {
      await fs.rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  }
}

/**
 * The real per-company entry point (#381): fetch a company's CURRENT Gitea
 * repo state (its own repo, own commits — including whatever #374's
 * task-resolver has already merged) and deploy it. This is what should
 * eventually replace the shared-image `ensureCompanyService()` call in
 * railway-deploy.ts once #380's Railway API token is provisioned — kept as
 * its own function rather than wired into that call site directly, since
 * this session was scoped to NOT flip RAILWAY_DEPLOY_ENABLED or touch the
 * live paid-checkout trigger (that remains #380's job).
 *
 * Returns `{ok:false, reason:'no_repo'}` (not an error) for a company that
 * hasn't been git-provisioned yet — a normal state, matching
 * fetchRepoFiles()'s own "missing repo isn't an error" contract.
 */
export async function deployCompanyFromGitea(
  workspaceId: string,
  slug: string,
  alreadyProvisioned = false,
): Promise<CompanyDeployResult> {
  const org = orgNameForWorkspace(workspaceId)
  const files = await fetchRepoFiles(org, slug)
  if (!files) return { ok: false, reason: 'no_repo' }
  return deployCompanyApp(slug, files, alreadyProvisioned)
}

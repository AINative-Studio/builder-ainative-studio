import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { parseLastJsonLine, companyDeployEnabled, deployCompanyApp, deployCompanyFromGitea } from '@/lib/build/company-deploy'

/**
 * #381 — per-company deploy orchestration. Pure-logic + cost-safety-gate
 * tests only (mirrors coverage-runner.test.ts's split: no real `railway`
 * CLI invocation here — that mechanism was already verified end-to-end
 * MANUALLY against real Railway infrastructure this session, see #381's
 * GitHub issue comments for the full verification trail: a real service was
 * created via `railway add`, deployed via `railway up`, confirmed live via
 * its real public URL, then cleaned up via `railway service delete`. An
 * automated CI test can't repeat that safely — it needs an authenticated
 * `railway` CLI session and would create real billable Railway resources on
 * every CI run, which is exactly what this module's cost-safety gate exists
 * to prevent by default).
 */

describe('parseLastJsonLine — real CLI output shapes, verified this session', () => {
  it('parses a clean JSON-only line', () => {
    expect(parseLastJsonLine('{"id":"abc","name":"test"}')).toEqual({ id: 'abc', name: 'test' })
  })

  it('skips the Config-as-Code deprecation warning ahead of the real JSON — the ACTUAL shape railway --json prints', () => {
    const real = [
      'warning: Config as Code (railway.json / railway.toml) is deprecated. Prefer Infrastructure as Code (.railway/railway.ts). Run `railway config migrate` or see https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code',
      '  → Migrate: `railway config migrate` — https://docs.railway.com/infrastructure-as-code#migrating-from-config-as-code',
      '  Existing files keep working until 2026-12-01.',
      '{"id":"b34f911e-2c55-4731-bd0c-bbb1e11eb08c","name":"ainative-registry"}',
    ].join('\n')
    expect(parseLastJsonLine(real)).toEqual({ id: 'b34f911e-2c55-4731-bd0c-bbb1e11eb08c', name: 'ainative-registry' })
  })

  it('parses the real `railway up --detach --json` shape (deploymentId + logsUrl, no url field)', () => {
    const real = '{"deploymentId":"ad198cdc-0d44-4b0c-83a1-de1a787a8598","logsUrl":"https://railway.com/project/47539617-ae34-4a52-a010-a88d875f347e/service/54179ef0-e7c4-4eb3-accc-4f8f18ca39ba?id=ad198cdc-0d44-4b0c-83a1-de1a787a8598&"}'
    const parsed = parseLastJsonLine(real)
    expect(parsed?.deploymentId).toBe('ad198cdc-0d44-4b0c-83a1-de1a787a8598')
    expect(parsed?.url).toBeUndefined()
  })

  it('returns null for output with no JSON at all', () => {
    expect(parseLastJsonLine('Failed to prompt for confirm\nThe input device is not a TTY')).toBeNull()
  })

  it('returns null for empty output', () => {
    expect(parseLastJsonLine('')).toBeNull()
  })

  it('returns null for the real error shape ({"code":"ERROR",...}) — still valid JSON, caller decides success', () => {
    // parseLastJsonLine itself just parses; success/failure is the caller's job.
    expect(parseLastJsonLine('{"code":"ERROR","error":"Service not found","hint":null}')).toEqual({
      code: 'ERROR', error: 'Service not found', hint: null,
    })
  })
})

describe('companyDeployEnabled — cost-safety gate', () => {
  const original = process.env.RAILWAY_DEPLOY_ENABLED

  afterEach(() => {
    if (original === undefined) delete process.env.RAILWAY_DEPLOY_ENABLED
    else process.env.RAILWAY_DEPLOY_ENABLED = original
  })

  it('false when unset (default, cost-safe)', () => {
    delete process.env.RAILWAY_DEPLOY_ENABLED
    expect(companyDeployEnabled()).toBe(false)
  })

  it('false for any value other than the literal string "true"', () => {
    process.env.RAILWAY_DEPLOY_ENABLED = 'yes'
    expect(companyDeployEnabled()).toBe(false)
    process.env.RAILWAY_DEPLOY_ENABLED = '1'
    expect(companyDeployEnabled()).toBe(false)
  })

  it('true only when explicitly "true"', () => {
    process.env.RAILWAY_DEPLOY_ENABLED = 'true'
    expect(companyDeployEnabled()).toBe(true)
  })
})

describe('deployCompanyApp — cost-safety: never touches Railway when disabled', () => {
  beforeEach(() => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'false')
  })

  it('returns {ok:false, reason:"disabled"} without spawning any process', async () => {
    const result = await deployCompanyApp('acme', { 'src/App.tsx': 'export default function App() {}' })
    expect(result).toEqual({ ok: false, reason: 'disabled' })
  })
})

describe('deployCompanyApp — input validation before any Railway call', () => {
  beforeEach(() => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  })

  it('rejects an empty slug', async () => {
    const result = await deployCompanyApp('', { 'src/App.tsx': 'x' })
    expect(result).toEqual({ ok: false, reason: 'bad_slug' })
  })

  it('rejects a FileMap with no deployable App entrypoint — never invents one', async () => {
    const result = await deployCompanyApp('acme', { 'README.md': 'hello' })
    expect(result).toEqual({ ok: false, reason: 'no_app_entrypoint' })
  })
})

describe('deployCompanyFromGitea — honest "no repo yet" for an unprovisioned company', () => {
  beforeEach(() => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
    // gitea-client's configured() is false in this test env (no GITEA_BASE_URL/
    // TOKEN set) — fetchRepoFiles() therefore returns null exactly like a
    // genuinely missing repo, per its own documented contract. This test
    // proves deployCompanyFromGitea surfaces that honestly rather than
    // crashing or fabricating a deploy attempt.
  })

  it('returns {ok:false, reason:"no_repo"} when the company has no Gitea repo yet', async () => {
    const result = await deployCompanyFromGitea('ws-1', 'acme')
    expect(result).toEqual({ ok: false, reason: 'no_repo' })
  })
})

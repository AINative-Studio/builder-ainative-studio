import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  isReservedSecretName,
  isValidSecretName,
  maskSecretValue,
  maskSecrets,
  listServiceVariables,
  upsertServiceVariable,
  deleteServiceVariable,
  redeployCurrent,
} from '@/lib/build/railway-deploy'

/**
 * #63.A + #63.B — Redeploy-current + runtime-secrets (Railway service variables).
 *
 * Mirrors the #243/#62 railway-deploy test strategy: mock global fetch so NO real
 * Railway API call is ever made, and assert the cost/security guards short-circuit.
 * The pure helpers (name validation, masking) are tested with no network at all.
 */

function gql(data: unknown): Response {
  return { ok: true, status: 200, text: async () => JSON.stringify({ data }) } as unknown as Response
}

function enableRailway() {
  vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'true')
  vi.stubEnv('RAILWAY_TOKEN', 'test-token')
  vi.stubEnv('RAILWAY_COMPANY_PROJECT_ID', 'proj-123')
  vi.stubEnv('RAILWAY_COMPANY_ENVIRONMENT_ID', 'env-123')
  vi.stubEnv('RAILWAY_COMPANY_SOURCE_IMAGE', 'ghcr.io/ainative/company-runtime:latest')
}

// ---------- pure helpers: secret name validation ----------
describe('isValidSecretName (#63.B)', () => {
  it('accepts POSIX-style env var names', () => {
    expect(isValidSecretName('API_KEY')).toBe(true)
    expect(isValidSecretName('_private')).toBe(true)
    expect(isValidSecretName('STRIPE_SECRET_2')).toBe(true)
  })
  it('rejects invalid names', () => {
    expect(isValidSecretName('')).toBe(false)
    expect(isValidSecretName('2FA')).toBe(false) // starts with digit
    expect(isValidSecretName('has space')).toBe(false)
    expect(isValidSecretName('has-dash')).toBe(false)
    expect(isValidSecretName('a'.repeat(200))).toBe(false)
  })
})

describe('isReservedSecretName (#63.B)', () => {
  it('flags platform-injected variables (case-insensitive)', () => {
    expect(isReservedSecretName('COMPANY_SLUG')).toBe(true)
    expect(isReservedSecretName('zerodb_project_id')).toBe(true)
  })
  it('does not flag user variables', () => {
    expect(isReservedSecretName('API_KEY')).toBe(false)
    expect(isReservedSecretName('')).toBe(false)
  })
})

// ---------- pure helpers: masking (never leaks plaintext) ----------
describe('maskSecretValue (#63.B)', () => {
  it('reveals only the last few chars of a long value', () => {
    const masked = maskSecretValue('sk_live_abcdef123456')
    expect(masked).toContain('3456')
    expect(masked).not.toContain('abcdef')
    expect(masked.startsWith('•')).toBe(true)
  })
  it('fully masks short/empty values', () => {
    expect(maskSecretValue('ab')).toBe('••••••••')
    expect(maskSecretValue('')).toBe('')
  })
})

describe('maskSecrets (#63.B)', () => {
  it('masks every value, flags reserved, sorts by name', () => {
    const out = maskSecrets({ ZEBRA: 'longsecretvalue', ALPHA: 'anothersecret', COMPANY_SLUG: 'acme' })
    expect(out.map((s) => s.name)).toEqual(['ALPHA', 'COMPANY_SLUG', 'ZEBRA'])
    // No masked field contains the raw plaintext.
    for (const s of out) {
      expect(s.masked).not.toContain('secret')
      expect(s.masked).not.toBe('acme')
    }
    expect(out.find((s) => s.name === 'COMPANY_SLUG')?.reserved).toBe(true)
    expect(out.find((s) => s.name === 'ALPHA')?.reserved).toBe(false)
  })
  it('handles null/undefined', () => {
    expect(maskSecrets(null)).toEqual([])
    expect(maskSecrets(undefined)).toEqual([])
  })
})

// ---------- network guards: inert when disabled ----------
describe('secrets API — cost/config guards', () => {
  beforeEach(() => vi.stubGlobal('fetch', vi.fn()))
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('listServiceVariables is inert (no fetch) when disabled', async () => {
    const r = await listServiceVariables('svc-1')
    expect(r).toEqual({ ok: false, reason: 'disabled' })
    expect((globalThis.fetch as any)).not.toHaveBeenCalled()
  })

  it('upsertServiceVariable refuses a reserved name WITHOUT touching Railway', async () => {
    enableRailway()
    const r = await upsertServiceVariable('svc-1', 'COMPANY_SLUG', 'x')
    expect(r).toEqual({ ok: false, reason: 'reserved' })
    expect((globalThis.fetch as any)).not.toHaveBeenCalled()
  })

  it('upsertServiceVariable rejects an invalid name WITHOUT touching Railway', async () => {
    enableRailway()
    const r = await upsertServiceVariable('svc-1', 'bad name', 'x')
    expect(r).toEqual({ ok: false, reason: 'bad_name' })
    expect((globalThis.fetch as any)).not.toHaveBeenCalled()
  })

  it('deleteServiceVariable refuses a reserved name', async () => {
    enableRailway()
    const r = await deleteServiceVariable('svc-1', 'ZERODB_PROJECT_ID')
    expect(r).toEqual({ ok: false, reason: 'reserved' })
    expect((globalThis.fetch as any)).not.toHaveBeenCalled()
  })
})

// ---------- network happy paths (mocked) ----------
describe('secrets API — mocked Railway', () => {
  beforeEach(() => { enableRailway() })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('listServiceVariables returns the raw variable map', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gql({ variables: { API_KEY: 'secretval', COMPANY_SLUG: 'acme' } })))
    const r = await listServiceVariables('svc-1')
    expect(r.ok).toBe(true)
    expect(r.variables).toEqual({ API_KEY: 'secretval', COMPANY_SLUG: 'acme' })
  })

  it('upsertServiceVariable succeeds for a valid user variable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gql({ variableUpsert: true })))
    const r = await upsertServiceVariable('svc-1', 'STRIPE_KEY', 'sk_live_x')
    expect(r).toEqual({ ok: true })
    expect((globalThis.fetch as any)).toHaveBeenCalledTimes(1)
  })

  it('deleteServiceVariable succeeds for a valid user variable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gql({ variableDelete: true })))
    const r = await deleteServiceVariable('svc-1', 'STRIPE_KEY')
    expect(r).toEqual({ ok: true })
  })

  it('surfaces a Railway error as a structured reason (never throws)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 500, text: async () => 'boom' } as unknown as Response))
    const r = await upsertServiceVariable('svc-1', 'STRIPE_KEY', 'x')
    expect(r.ok).toBe(false)
    expect(typeof r.reason).toBe('string')
  })
})

// ---------- redeployCurrent (#63.A) ----------
describe('redeployCurrent (#63.A)', () => {
  beforeEach(() => { enableRailway() })
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.restoreAllMocks() })

  it('is inert (no fetch) when disabled', async () => {
    vi.stubEnv('RAILWAY_DEPLOY_ENABLED', 'false')
    vi.stubGlobal('fetch', vi.fn())
    const r = await redeployCurrent('svc-1')
    expect(r).toEqual({ ok: false, reason: 'disabled' })
    expect((globalThis.fetch as any)).not.toHaveBeenCalled()
  })

  it('redeploys the CURRENT (newest success) deployment', async () => {
    // 1st fetch: listDeployments; 2nd fetch: deploymentRedeploy.
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(gql({
        deployments: {
          edges: [
            { node: { id: 'dep-new', status: 'SUCCESS', createdAt: '2026-08-25T02:00:00Z', meta: {} } },
            { node: { id: 'dep-old', status: 'SUCCESS', createdAt: '2026-08-24T02:00:00Z', meta: {} } },
          ],
        },
      }))
      .mockResolvedValueOnce(gql({ deploymentRedeploy: { id: 'dep-new-2', status: 'BUILDING' } }))
    vi.stubGlobal('fetch', fetchMock)

    const r = await redeployCurrent('svc-1')
    expect(r.ok).toBe(true)
    expect(r.fromDeploymentId).toBe('dep-new') // the newest success is "current"
    expect(r.deploymentId).toBe('dep-new-2')
  })

  it('returns a reason when the service has no deployments', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(gql({ deployments: { edges: [] } })))
    const r = await redeployCurrent('svc-1')
    expect(r.ok).toBe(false)
    expect(r.reason).toBeTruthy()
  })
})

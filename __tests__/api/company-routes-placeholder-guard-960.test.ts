import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#960 — API-boundary backstop.
 *
 * The real entry point is guarded in contexts/build-context.tsx, but both
 * company-track generation routes embed `name` and `idea` VERBATIM in their
 * codegen prompts, so a placeholder reaching them at all buys a real, billable
 * generation plus a garbage public showcase entry. These tests pin that both
 * routes reject unsubstituted template syntax with a 400 BEFORE any generation
 * is kicked off — for every caller, present and future, not just the deep link.
 *
 * `resolveApp`/`registerApp` etc. are mocked so a pass through the guard would
 * be plainly visible (the route would reach the registry/generation path);
 * a rejection must happen before any of them is touched.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(async () => null),
  registerApp: vi.fn(async () => true),
  resolvePendingProductGeneration: vi.fn(async () => null),
  recordPendingProductGeneration: vi.fn(async () => {}),
  markProductGenerationRegistered: vi.fn(async () => {}),
  loadGeneration: vi.fn(async () => null),
  logBuildOutcome: vi.fn(async () => {}),
  reportDeploymentHealthStage: vi.fn(async () => {}),
  fetchSpy: vi.fn(),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  // builder#1041: the routes now read the honest `verified` flag (#807/#832/
  // #833) so a FAILED registry read can no longer look like a confirmed miss
  // and buy a fresh billable generation. Delegated to this file's existing
  // `resolveApp` mock with verified:true, so every expectation below keeps its
  // original meaning: a null entry here is a CONFIRMED miss, which still
  // generates. The unverified path has its own dedicated coverage in
  // __tests__/api/company-codegen-registry-failure-idempotency-1041.test.ts.
  resolveAppVerified: async () => ({ entry: await h.resolveApp(), verified: true }),
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/product-generation-state', () => ({
  recordPendingProductGeneration: h.recordPendingProductGeneration,
  markProductGenerationRegistered: h.markProductGenerationRegistered,
  resolvePendingProductGeneration: h.resolvePendingProductGeneration,
  // #1051: the real routes now call the Verified variant. Derive it from
  // the existing mock so every pre-existing mockResolvedValue(...) call
  // keeps driving the same behavior unchanged -- verified: true is correct
  // for all of them since none exercise the new unverified-read path.
  resolvePendingProductGenerationVerified: vi.fn(async () => ({
    state: await h.resolvePendingProductGeneration(),
    verified: true,
  })),
}))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: h.loadGeneration }))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))
vi.mock('@/lib/build/deployment-health', () => ({ reportDeploymentHealthStage: h.reportDeploymentHealthStage }))

import { POST as companyAppPOST } from '@/app/api/build/company-app/route'
import { POST as companyProductPOST } from '@/app/api/build/company-product/route'

function req(body: Record<string, unknown>) {
  return {
    url: 'https://builder.ainative.studio/api/build/company-app',
    json: async () => body,
  } as any
}

// The exact value from the live incident: a ?company= deep-link param copied
// out of markdown with its closing code-span backtick still attached.
const BAD = '{slug}`'

describe.each([
  ['company-app', companyAppPOST],
  ['company-product', companyProductPOST],
])('POST /api/build/%s — rejects unsubstituted placeholders (builder#960)', (_name, POST) => {
  beforeEach(() => {
    h.resolveApp.mockReset(); h.resolveApp.mockResolvedValue(null)
    h.registerApp.mockReset(); h.registerApp.mockResolvedValue(true)
    h.resolvePendingProductGeneration.mockReset(); h.resolvePendingProductGeneration.mockResolvedValue(null)
    h.fetchSpy.mockReset()
    vi.stubGlobal('fetch', h.fetchSpy)
  })

  it('400s when idea is the literal placeholder found live', async () => {
    const res = await POST(req({ idea: BAD, slug: 'slug', name: BAD }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/unsubstituted template placeholder/i)
  })

  it('400s when only `name` carries the placeholder and the idea is real', async () => {
    const res = await POST(req({ idea: 'a habit tracker for runners', slug: 'runners', name: BAD }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/^name/)
  })

  it('400s when only `idea` carries the placeholder and the name is real', async () => {
    const res = await POST(req({ idea: '${idea}', slug: 'acme', name: 'Acme' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toMatch(/^idea/)
  })

  it('rejects BEFORE touching the app registry or starting any generation', async () => {
    await POST(req({ idea: BAD, slug: 'slug', name: BAD }))
    expect(h.resolveApp).not.toHaveBeenCalled()
    expect(h.registerApp).not.toHaveBeenCalled()
    expect(h.fetchSpy).not.toHaveBeenCalled()
  })

  it('still accepts a real idea + real name (the guard is not over-broad)', async () => {
    const res = await POST(req({
      idea: 'a personalized business advisor that forecasts revenue from pipeline data',
      slug: 'meridian',
      name: 'Meridian',
    }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.error).toBeUndefined()
    expect(body.status).toBe('processing')
  })

  it('keeps the pre-existing required-field behavior unchanged', async () => {
    const res = await POST(req({ slug: 'meridian' })) // no idea
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('idea and slug required')
  })
})

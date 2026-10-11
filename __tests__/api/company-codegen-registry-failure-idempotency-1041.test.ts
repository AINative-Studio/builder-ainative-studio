import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * builder#1041 — a transient registry read failure must not buy a fresh,
 * billable codegen run for a company that is ALREADY generated.
 *
 * #1041 was filed on the hypothesis that components/build/screens/Live.tsx
 * fires real paid codegen POSTs on every Live dashboard load whenever the
 * local `ainative_build_<slug>` cache is stale (`appChatId: ''`,
 * `productChatId: ''` — #1037's exact repro shape), because both POST sites
 * gate purely on that local state. The first half of that is true: the gates
 * at Live.tsx are `if (!state.appChatId && ...)` / `if (!state.productChatId
 * && ...)`, with no server consultation before firing.
 *
 * The second half is not. Both routes already carry a real server-side
 * existence check (`resolveApp(slug)` → `{ chatId, cached: true }`), verified
 * live against production on the very company #1037 reproduced on:
 *
 *   POST /api/build/company-app     {"idea":"silo","slug":"silo",...}
 *     → {"chatId":"JMBmjUQcE_FBl3SDKW68k","cached":true}            (0.56s)
 *   POST /api/build/company-product {"idea":"silo","slug":"silo",...}
 *     → {"chatId":"GqdGgOj6eJl4l5GFdtBQn","productSlug":"silo-product",
 *        "status":"cached"}                                          (0.51s)
 *
 * Sub-second, cached, no generation. So the repeat POST is wasted round trips,
 * not wasted spend — on the happy path.
 *
 * The REAL defect is narrower and is the #807/#832/#833 bug class, left
 * unfixed on the spend path. `resolveAppVerified` deliberately distinguishes
 * "confirmed gone" (`verified: true`) from "couldn't check" (`verified:
 * false`, returned for a non-ok response, a thrown fetch, a 20s timeout, or an
 * unconfigured environment). Plain `resolveApp` collapses both into `null` —
 * and both codegen routes call plain `resolveApp`. So a transient
 * builder_app_registry read failure (this repo's documented flaky
 * 1MB/~20s-timeout reads; the registry fetch pulls `?limit=1000` rows) makes
 * an already-generated company look brand new, and the route proceeds to a
 * real, billable generation. Combined with Live.tsx's unguarded re-POST on
 * every load, every dashboard load during a registry hiccup is a fresh charge.
 *
 * Properties under test, for BOTH routes:
 *  - a CONFIRMED miss (verified: true, no entry) still generates — a genuinely
 *    new company must not be suppressed;
 *  - an UNCONFIRMED read (verified: false) does NOT generate, and reports
 *    honestly instead of silently claiming success.
 */

const h = vi.hoisted(() => ({
  resolveApp: vi.fn(),
  resolveAppVerified: vi.fn(),
  registerApp: vi.fn(async () => true),
  resolvePendingProductGeneration: vi.fn(async () => null),
  recordPendingProductGeneration: vi.fn(async () => {}),
  markProductGenerationRegistered: vi.fn(async () => {}),
  loadGeneration: vi.fn(async () => null),
  logBuildOutcome: vi.fn(async () => {}),
  reportDeploymentHealthStage: vi.fn(async () => {}),
}))

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: h.resolveApp,
  resolveAppVerified: h.resolveAppVerified,
  registerApp: h.registerApp,
}))
vi.mock('@/lib/build/product-generation-state', () => ({
  recordPendingProductGeneration: h.recordPendingProductGeneration,
  markProductGenerationRegistered: h.markProductGenerationRegistered,
  resolvePendingProductGeneration: h.resolvePendingProductGeneration,
}))
vi.mock('@/lib/zerodb-store', () => ({ loadGeneration: h.loadGeneration }))
vi.mock('@/lib/build/learning', () => ({ logBuildOutcome: h.logBuildOutcome }))
vi.mock('@/lib/build/deployment-health', () => ({
  reportDeploymentHealthStage: h.reportDeploymentHealthStage,
}))

function req(body: unknown): any {
  return {
    json: async () => body,
    url: 'https://builder.ainative.studio/api/build/company-app',
  } as any
}

/**
 * Did this request actually kick off a real generation? The only way either
 * route starts one is a POST to /api/chat-ws (the billable codegen pipeline),
 * so a spy on global fetch is the honest, implementation-agnostic probe.
 */
function chatWsCalls(fetchSpy: ReturnType<typeof vi.fn>): unknown[] {
  return fetchSpy.mock.calls.filter((c) => String(c[0] ?? '').includes('/api/chat-ws'))
}

describe('builder#1041: codegen routes must not generate on an UNCONFIRMED registry read', () => {
  let fetchSpy: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    h.resolvePendingProductGeneration.mockResolvedValue(null)
    h.loadGeneration.mockResolvedValue(null)
    // A generation that never resolves: if a route DOES start one, the spy
    // records it, and nothing here depends on the stream completing.
    fetchSpy = vi.fn(async () => new Promise(() => {}) as any)
    vi.stubGlobal('fetch', fetchSpy)
  })

  describe('/api/build/company-app', () => {
    it('a CONFIRMED miss still starts a real generation (a genuinely new company must not be suppressed)', async () => {
      h.resolveApp.mockResolvedValue(null)
      h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
      const { POST } = await import('@/app/api/build/company-app/route')

      const res = await POST(req({ idea: 'a real new idea', slug: 'brandnew', name: 'BrandNew' }))
      const body = await res.json()

      expect(body.status).toBe('processing')
      expect(chatWsCalls(fetchSpy).length).toBe(1)
    })

    it('an UNCONFIRMED registry read does NOT start a generation (#1041: no billable retry on a transient read failure)', async () => {
      // The exact shape resolveAppVerified returns for a non-ok response, a
      // thrown fetch, a 20s timeout, or an unconfigured environment.
      h.resolveApp.mockResolvedValue(null)
      h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
      const { POST } = await import('@/app/api/build/company-app/route')

      const res = await POST(req({ idea: 'silo', slug: 'silo', name: 'Silo' }))
      const body = await res.json()

      expect(chatWsCalls(fetchSpy).length).toBe(0)
      // And it must say so honestly rather than reporting a false 'processing'
      // that sends the client into a 5-minute poll for a build never started.
      expect(body.status).toBe('unverified')
    })
  })

  describe('/api/build/company-product', () => {
    it('a CONFIRMED miss still starts a real generation', async () => {
      h.resolveApp.mockResolvedValue(null)
      h.resolveAppVerified.mockResolvedValue({ entry: null, verified: true })
      const { POST } = await import('@/app/api/build/company-product/route')

      const res = await POST(req({ idea: 'a real new idea', slug: 'brandnew', name: 'BrandNew' }))
      const body = await res.json()

      expect(body.status).toBe('processing')
      expect(chatWsCalls(fetchSpy).length).toBe(1)
    })

    it('an UNCONFIRMED registry read does NOT start a generation (#1041)', async () => {
      h.resolveApp.mockResolvedValue(null)
      h.resolveAppVerified.mockResolvedValue({ entry: null, verified: false })
      const { POST } = await import('@/app/api/build/company-product/route')

      const res = await POST(req({ idea: 'silo', slug: 'silo', name: 'Silo' }))
      const body = await res.json()

      expect(chatWsCalls(fetchSpy).length).toBe(0)
      expect(body.status).toBe('unverified')
    })
  })
})

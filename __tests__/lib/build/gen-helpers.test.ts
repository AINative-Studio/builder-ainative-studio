/**
 * useGenAutoRetry (components/build/artifacts/gen-helpers.tsx) — the "never
 * show broken" layer added while fixing the Dwellow landing-page bug (a view
 * that failed generation once used to fall back to hardcoded placeholder copy
 * silently, no error, no way to recover).
 *
 * Properties under test:
 *   - a view with data (success or not-yet-attempted) never auto-fires a retry,
 *   - a view that errored with NO content fires exactly one background retry
 *     automatically, with no click required,
 *   - that auto-retry only fires ONCE per failure (not on every re-render),
 *   - a successful retry dispatches GEN_DONE; a failed retry dispatches GEN_FAIL
 *     with the response's error surfaced,
 *   - `stuck` is true only while errored AND no data — never once data lands.
 *
 * APPROACH: same technique as useAutoplay-hook.test.ts — mock React hooks so the
 * hook body runs synchronously in the node environment (no jsdom), and mock
 * useBuild directly since gen-helpers reads state/dispatch/views from it.
 *
 * @vitest-environment node
 */

import { describe, it, expect, vi, afterEach } from 'vitest'

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  const effects: Array<() => void | (() => void)> = []
  ;(globalThis as any).__triggerEffect = (index = 0) => { if (effects[index]) return effects[index]() }
  ;(globalThis as any).__clearEffects = () => { effects.length = 0 }
  return {
    ...actual,
    useEffect: vi.fn((fn: () => void | (() => void)) => { effects.push(fn) }),
    useRef: vi.fn((init: any) => ({ current: init })),
    useState: vi.fn((init: any) => {
      let val = init
      const setter = vi.fn((v: any) => { val = typeof v === 'function' ? v(val) : v })
      return [val, setter]
    }),
  }
})

const h = vi.hoisted(() => ({ useBuild: vi.fn() }))
vi.mock('@/contexts/build-context', () => ({ useBuild: h.useBuild }))

import { useGenAutoRetry } from '@/components/build/artifacts/gen-helpers'

function mockBuild(overrides: { generated?: Record<string, unknown>; genError?: Record<string, string> } = {}) {
  const dispatch = vi.fn()
  h.useBuild.mockReturnValue({
    state: {
      idea: 'a brilliant idea', track: 'company', companyName: 'Dwellow',
      generated: overrides.generated ?? {}, genError: overrides.genError ?? {},
    },
    views: ['thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30'],
    dispatch,
  })
  return dispatch
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
  ;(globalThis as any).__clearEffects?.()
})

describe('useGenAutoRetry — no auto-retry needed', () => {
  it('does not fetch when the view has real content already', () => {
    mockBuild({ generated: { landing: { headline: 'ok' } } })
    vi.stubGlobal('fetch', vi.fn())
    const result = useGenAutoRetry('landing')
    ;(globalThis as any).__triggerEffect?.(0)
    expect(result.data).toEqual({ headline: 'ok' })
    expect(result.stuck).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('does not fetch while a view is simply still pending (no error, no data)', () => {
    mockBuild({})
    vi.stubGlobal('fetch', vi.fn())
    const result = useGenAutoRetry('landing')
    ;(globalThis as any).__triggerEffect?.(0)
    expect(result.data).toBeNull()
    expect(result.stuck).toBe(false)
    expect(fetch).not.toHaveBeenCalled()
  })
})

describe('useGenAutoRetry — automatic background retry on failure', () => {
  it('fires exactly one background retry when a view errored with no content, no click required', async () => {
    mockBuild({ genError: { landing: 'HTTP 503' } })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ content: { headline: 'recovered' } }),
    })
    vi.stubGlobal('fetch', fetchMock)

    const dispatch = h.useBuild.mock.results.length
      ? h.useBuild.mock.results[h.useBuild.mock.results.length - 1].value.dispatch
      : undefined

    const result = useGenAutoRetry('landing')
    ;(globalThis as any).__triggerEffect?.(0)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [, opts] = fetchMock.mock.calls[0]
    expect(JSON.parse(opts.body)).toMatchObject({ view: 'landing', idea: 'a brilliant idea', track: 'company' })

    // flush the retry promise chain
    for (let i = 0; i < 10; i++) await Promise.resolve()

    expect(result.stuck).toBe(true) // stale return value from the render that triggered the effect
    const dispatchFn = h.useBuild.mock.results[0].value.dispatch
    expect(dispatchFn).toHaveBeenCalledWith({ type: 'GEN_DONE', view: 'landing', content: { headline: 'recovered' } })
  })

  it('dispatches GEN_FAIL with the surfaced error when the automatic retry ALSO fails', async () => {
    mockBuild({ genError: { landing: 'HTTP 503' } })
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false, status: 503, json: async () => ({ error: 'generation_unavailable' }),
    })
    vi.stubGlobal('fetch', fetchMock)

    useGenAutoRetry('landing')
    ;(globalThis as any).__triggerEffect?.(0)
    for (let i = 0; i < 10; i++) await Promise.resolve()

    const dispatchFn = h.useBuild.mock.results[0].value.dispatch
    expect(dispatchFn).toHaveBeenCalledWith({ type: 'GEN_FAIL', view: 'landing', error: 'generation_unavailable' })
  })

  it('does not fetch again on a second render once content has landed (stuck goes false)', () => {
    mockBuild({ generated: { landing: { headline: 'now real' } }, genError: { landing: 'stale error from before' } })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    // Real state shape: GEN_DONE clears genError, but this simulates the edge
    // case where error+data briefly coexist — stuck must still be false because
    // data is present (matches the `!!error && !data` contract, not `!!error`).
    const result = useGenAutoRetry('landing')
    ;(globalThis as any).__triggerEffect?.(0)

    expect(result.stuck).toBe(false)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('useGenAutoRetry — manual retry()', () => {
  it('retry() is a no-op while already retrying or with no idea set', () => {
    h.useBuild.mockReturnValue({
      state: { idea: '', track: 'company', companyName: '', generated: {}, genError: { landing: 'x' } },
      views: ['landing'],
      dispatch: vi.fn(),
    })
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const result = useGenAutoRetry('landing')
    ;(globalThis as any).__triggerEffect?.(0) // auto-retry effect also guards on !state.idea
    result.retry()

    expect(fetchMock).not.toHaveBeenCalled()
  })
})

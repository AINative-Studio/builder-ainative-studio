import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Hook-level tests for useHeaderHeightVar.ts (#754) — the runtime measurement
 * that replaces the hardcoded `calc(100vh - 24px)` sticky-chat-column CSS.
 *
 * Verifies:
 *  - the measured header height (via getBoundingClientRect) is written to the
 *    target container's `--live-header-h` custom property, not guessed.
 *  - a ResizeObserver is wired to the header element so height changes across
 *    the real banner states (#748: paid/trial/provisioning/anonymous — each a
 *    different height) keep the CSS var truthful, not just the initial paint.
 *  - the observer is disconnected on unmount (no leaked observers).
 *  - when containerRef is never attached separately, the property is still
 *    set directly on the header element itself (single-ref usage).
 *
 * APPROACH: this project's vitest config runs in the `node` environment (no
 * jsdom) to avoid OOM in other build hooks (see useAutoplay-hook.test.ts's own
 * doc comment) — we follow the same pattern here: mock React's
 * useLayoutEffect/useRef so the hook body runs synchronously against plain
 * fake DOM-like objects instead of a real renderer.
 */

vi.mock('react', async () => {
  const actual = await vi.importActual<typeof import('react')>('react')
  const layoutEffects: Array<() => void | (() => void)> = []

  ;(globalThis as any).__triggerLayoutEffect = (index = 0) => {
    if (layoutEffects[index]) return layoutEffects[index]()
  }
  ;(globalThis as any).__clearLayoutEffects = () => { layoutEffects.length = 0 }

  return {
    ...actual,
    useLayoutEffect: vi.fn((fn: () => void | (() => void)) => {
      layoutEffects.push(fn)
    }),
    useRef: vi.fn((init: any) => ({ current: init })),
  }
})

import { useHeaderHeightVar, LIVE_HEADER_HEIGHT_VAR } from '@/lib/build/useHeaderHeightVar'

/** A minimal fake HTMLElement — just enough surface for the hook. */
function fakeEl(height: number) {
  const styleProps: Record<string, string> = {}
  return {
    getBoundingClientRect: () => ({ height }),
    style: {
      setProperty: (name: string, value: string) => { styleProps[name] = value },
    },
    __styleProps: styleProps,
  } as unknown as HTMLElement & { __styleProps: Record<string, string> }
}

describe('useHeaderHeightVar (#754)', () => {
  let observeSpy: ReturnType<typeof vi.fn>
  let disconnectSpy: ReturnType<typeof vi.fn>
  let capturedCallback: (() => void) | null

  beforeEach(() => {
    ;(globalThis as any).__clearLayoutEffects()
    observeSpy = vi.fn()
    disconnectSpy = vi.fn()
    capturedCallback = null
    ;(globalThis as any).ResizeObserver = vi.fn().mockImplementation((cb: () => void) => {
      capturedCallback = cb
      return { observe: observeSpy, disconnect: disconnectSpy }
    })
  })

  afterEach(() => {
    delete (globalThis as any).ResizeObserver
  })

  it('writes the measured header height onto the container as the CSS var, with a distinct container ref', () => {
    const { headerRef, containerRef } = useHeaderHeightVar()
    headerRef.current = fakeEl(382) as any
    containerRef.current = fakeEl(0) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    const container = containerRef.current as any
    expect(container.__styleProps[LIVE_HEADER_HEIGHT_VAR]).toBe('382px')
  })

  it('falls back to setting the var on the header element itself when no separate container is attached', () => {
    const { headerRef, containerRef } = useHeaderHeightVar()
    headerRef.current = fakeEl(250) as any
    containerRef.current = null // never attached — single-ref usage

    ;(globalThis as any).__triggerLayoutEffect(0)

    const header = headerRef.current as any
    expect(header.__styleProps[LIVE_HEADER_HEIGHT_VAR]).toBe('250px')
  })

  it('rounds a fractional measured height up to a whole pixel (avoids subpixel jitter)', () => {
    const { headerRef, containerRef } = useHeaderHeightVar()
    headerRef.current = fakeEl(381.2) as any
    containerRef.current = fakeEl(0) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect((containerRef.current as any).__styleProps[LIVE_HEADER_HEIGHT_VAR]).toBe('382px')
  })

  it('observes the header element via ResizeObserver so later height changes (banner-state changes, #748) are re-measured', () => {
    const { headerRef, containerRef } = useHeaderHeightVar()
    const header = fakeEl(200)
    headerRef.current = header as any
    containerRef.current = fakeEl(0) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect(observeSpy).toHaveBeenCalledWith(header)

    // Simulate the banner growing (e.g. provisioning banner -> trial banner, #748).
    ;(header as any).getBoundingClientRect = () => ({ height: 460 })
    capturedCallback?.()

    expect((containerRef.current as any).__styleProps[LIVE_HEADER_HEIGHT_VAR]).toBe('460px')
  })

  it('disconnects the ResizeObserver on cleanup (no leaked observers across unmounts)', () => {
    const { headerRef, containerRef } = useHeaderHeightVar()
    headerRef.current = fakeEl(200) as any
    containerRef.current = fakeEl(0) as any

    const cleanup = (globalThis as any).__triggerLayoutEffect(0)
    expect(typeof cleanup).toBe('function')
    cleanup?.()

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('does nothing (no throw) when the header ref is not yet attached', () => {
    const { headerRef, containerRef } = useHeaderHeightVar()
    headerRef.current = null
    containerRef.current = null

    expect(() => (globalThis as any).__triggerLayoutEffect(0)).not.toThrow()
    expect(observeSpy).not.toHaveBeenCalled()
  })

  it('supports a custom CSS var name', () => {
    const { headerRef, containerRef } = useHeaderHeightVar('--custom-header-h')
    headerRef.current = fakeEl(120) as any
    containerRef.current = fakeEl(0) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect((containerRef.current as any).__styleProps['--custom-header-h']).toBe('120px')
    expect((containerRef.current as any).__styleProps[LIVE_HEADER_HEIGHT_VAR]).toBeUndefined()
  })
})

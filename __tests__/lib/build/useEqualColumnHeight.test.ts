import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

/**
 * Hook-level tests for useEqualColumnHeight.ts (#805, extended by #842) —
 * the real structural fix for the recurring Live dashboard grey-region-on-
 * scroll bug (#484, #754, #803, #810/#812, #842). `.m-live-grid` uses
 * align-items:start, so the left and middle columns are never equal height;
 * whichever is shorter exposes the grid's own grey divider background below
 * it. This hook measures both columns' real rendered height (scrollHeight)
 * at runtime and writes the taller one as a shared `--live-col-min-h`
 * custom property both columns read as a min-height floor.
 *
 * #842: the chat column also needs this shared var (its own sticky/height-
 * capped box moved to an inner wrapper so the outer `.m-live-col-chat` can
 * cover the full grid cell), but it's a SIBLING of the left/middle columns
 * this hook measures, and CSS custom properties only inherit to
 * descendants — so writing the var on the left/middle elements themselves
 * (the original #805 behavior) never reaches it. The hook now accepts an
 * optional `writeRef` pointing at a real ancestor of all three columns
 * (Live.tsx passes the same `containerRef` useHeaderHeightVar already
 * writes `--live-header-h` to); when omitted, it falls back to writing on
 * the left column itself, preserving the original #805 behavior for any
 * other caller.
 *
 * Follows the same test harness as useHeaderHeightVar.test.ts: this repo's
 * vitest config runs in the `node` environment (no jsdom), so React's
 * useLayoutEffect/useRef are mocked to run the hook body synchronously
 * against plain fake DOM-like objects.
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

import { useEqualColumnHeight, LIVE_COL_MIN_HEIGHT_VAR } from '@/lib/build/useEqualColumnHeight'

/** A minimal fake HTMLElement — just enough surface for the hook. */
function fakeCol(scrollHeight: number) {
  const styleProps: Record<string, string> = {}
  return {
    scrollHeight,
    style: {
      minHeight: '',
      setProperty: (name: string, value: string) => { styleProps[name] = value },
    },
    __styleProps: styleProps,
  } as unknown as HTMLElement & { __styleProps: Record<string, string>; scrollHeight: number }
}

describe('useEqualColumnHeight (#805)', () => {
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

  it('writes the TALLER column\'s scrollHeight to the left column as the shared min-height var (no writeRef given)', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    leftColRef.current = fakeCol(600) as any
    middleColRef.current = fakeCol(1400) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    // #842: with no writeRef, the var is written only on the left column
    // (the fallback target) — it does NOT also land on the middle column's
    // own inline style, since a real ancestor is what should carry it when
    // other siblings (like the chat column) also need to read it.
    expect((leftColRef.current as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBe('1400px')
  })

  it('picks the left column\'s height when it is the taller one', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    leftColRef.current = fakeCol(2000) as any
    middleColRef.current = fakeCol(900) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect((leftColRef.current as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBe('2000px')
  })

  it('#842: writes the shared min-height var onto a passed writeRef (a real ancestor) instead of the columns themselves, so a sibling column can inherit it too', () => {
    const writeRef = { current: fakeCol(0) }
    const { leftColRef, middleColRef } = useEqualColumnHeight(undefined, writeRef as any)
    leftColRef.current = fakeCol(600) as any
    middleColRef.current = fakeCol(1400) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect((writeRef.current as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBe('1400px')
    // Left/middle columns themselves are not written to directly anymore —
    // only measured from.
    expect((leftColRef.current as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBeUndefined()
    expect((middleColRef.current as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBeUndefined()
  })

  it('resets minHeight before measuring, so a shrinking column (accordion collapse) can shrink the shared max back down', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    const left = fakeCol(600)
    const middle = fakeCol(1400)
    left.style.minHeight = '1400px' // simulate a previous, now-stale floor
    middle.style.minHeight = '1400px'
    leftColRef.current = left as any
    middleColRef.current = middle as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect(left.style.minHeight).toBe('')
    expect(middle.style.minHeight).toBe('')
  })

  it('observes BOTH columns via ResizeObserver — either one growing/shrinking can change which is taller', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    const left = fakeCol(600)
    const middle = fakeCol(1400)
    leftColRef.current = left as any
    middleColRef.current = middle as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect(observeSpy).toHaveBeenCalledWith(left)
    expect(observeSpy).toHaveBeenCalledWith(middle)
    expect(observeSpy).toHaveBeenCalledTimes(2)
  })

  it('re-measures when the middle column shrinks below the left column (accordion section collapsed)', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    const left = fakeCol(1200)
    const middle = fakeCol(1400)
    leftColRef.current = left as any
    middleColRef.current = middle as any

    ;(globalThis as any).__triggerLayoutEffect(0)
    expect((left as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBe('1400px')

    // Founder collapses a middle-column accordion section.
    ;(middle as any).scrollHeight = 300
    capturedCallback?.()

    expect((left as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBe('1200px')
  })

  it('disconnects the ResizeObserver on cleanup (no leaked observers across unmounts)', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    leftColRef.current = fakeCol(600) as any
    middleColRef.current = fakeCol(1400) as any

    const cleanup = (globalThis as any).__triggerLayoutEffect(0)
    expect(typeof cleanup).toBe('function')
    cleanup?.()

    expect(disconnectSpy).toHaveBeenCalledTimes(1)
  })

  it('does nothing (no throw) when either ref is not yet attached', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight()
    leftColRef.current = null
    middleColRef.current = fakeCol(1000) as any

    expect(() => (globalThis as any).__triggerLayoutEffect(0)).not.toThrow()
    expect(observeSpy).not.toHaveBeenCalled()
  })

  it('supports a custom CSS var name', () => {
    const { leftColRef, middleColRef } = useEqualColumnHeight('--custom-col-min-h')
    leftColRef.current = fakeCol(500) as any
    middleColRef.current = fakeCol(800) as any

    ;(globalThis as any).__triggerLayoutEffect(0)

    expect((leftColRef.current as any).__styleProps['--custom-col-min-h']).toBe('800px')
    expect((leftColRef.current as any).__styleProps[LIVE_COL_MIN_HEIGHT_VAR]).toBeUndefined()
  })
})

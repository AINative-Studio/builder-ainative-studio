import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * Real bug found live (2026-10-20): a fixed reveal-timeout bound (lib/
 * sandpack/setup.ts's /index.tsx, tried 3s/8s/15s in turn) could never cover
 * every app size — vaultn's generation produced a single 30,000-char
 * App.tsx with no separate component files, and Tailwind's JIT genuinely
 * takes longer to compile that much JSX in one pass. Fix: scale the bound
 * to the REAL assembled App.tsx length instead of guessing one fixed
 * number. buildSandpackFiles() reports that length by prepending a tiny
 * preamble that sets window.__APP_SOURCE_CHARS__ as a side effect of
 * `/index.tsx`'s `import App from './App'` — which runs before that file's
 * own revealOnceStyled() call reads it.
 */
describe('buildSandpackFiles — reports real App.tsx content length for the reveal-timeout scaling (#1123)', () => {
  it('prepends a window.__APP_SOURCE_CHARS__ preamble reporting the real post-assembly App.tsx length', () => {
    const mainCode = "export default function App(){ return <div>hi</div> }"
    const built = buildSandpackFiles({ '/App.tsx': mainCode })
    expect(built['/App.tsx']).toContain('window as any).__APP_SOURCE_CHARS__')

    // The reported count must match the content length AFTER this pipeline's
    // own earlier assembly steps (e.g. a missing `import React` getting
    // prepended) but BEFORE the __APP_SOURCE_CHARS__ preamble itself — i.e.
    // it reports what Tailwind's JIT actually has to compile, not inflated
    // by the preamble's own injected line, and not just the raw input.
    const reported = Number(built['/App.tsx'].match(/__APP_SOURCE_CHARS__ = (\d+);/)?.[1])
    const preambleMatch = built['/App.tsx'].match(/^;\(window as any\)\.__APP_SOURCE_CHARS__ = \d+;\n/)
    expect(preambleMatch).toBeTruthy()
    const contentAfterPreamble = built['/App.tsx'].slice(preambleMatch![0].length)
    expect(reported).toBe(contentAfterPreamble.length)

    // The real app code must still be present and intact after the preamble.
    expect(built['/App.tsx']).toContain('export default function App')
  })

  it('a larger App.tsx reports a correspondingly larger char count', () => {
    const small = buildSandpackFiles({ '/App.tsx': "export default function App(){ return <div>x</div> }" })
    const large = buildSandpackFiles({ '/App.tsx': "export default function App(){ return <div>" + 'x'.repeat(5000) + "</div> }" })
    const extractCount = (code: string) => Number(code.match(/__APP_SOURCE_CHARS__ = (\d+);/)?.[1])
    expect(extractCount(large['/App.tsx'])).toBeGreaterThan(extractCount(small['/App.tsx']))
  })
})

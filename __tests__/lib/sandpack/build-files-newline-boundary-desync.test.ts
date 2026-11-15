import { describe, it, expect } from 'vitest'
import { buildSandpackFiles } from '@/lib/sandpack/build-files'

/**
 * #2034/#2053/#2057/#2059-class bug, the other half of the one
 * maskCommentsAndStrings() (lib/sandpack/build-files.ts) already partially
 * fixed live (2026-10-19 "younova"/"letterpress"/"shutter" repros — see
 * that function's doc comment): the contraction/apostrophe-after-word-char
 * check alone doesn't cover a `'` NOT preceded by a word character (a
 * decade reference like "the '90s", a leading quote like "'tis") that also
 * isn't a real string open. With no later same-line close, the fake "string"
 * swallows real JSX usage after it as if it were string content — hiding a
 * real `<Icon>`/`<Sibling>` reference from the shadcn/AIKit/lucide/sibling-
 * import "already used" checks that run against this masked view, so a
 * real, used component gets NO import injected at all (the "Element type is
 * invalid" / "X is not defined" crash class this whole file's history exists
 * to prevent).
 */
describe('build-files.ts maskCommentsAndStrings newline-boundary desync (#2057-class)', () => {
  it('still injects a missing lucide icon import for JSX usage after a decade-style apostrophe', () => {
    const appCode = `
function Hero() {
  return <p>Retro styles from the '90s are back. <Sparkles className="h-4 w-4" /></p>
}

export default function App() {
  return <Hero />
}
`
    const built = buildSandpackFiles({ '/App.tsx': appCode })
    const out = built['/App.tsx']
    expect(out).toMatch(/import\s*\{[^}]*\bSparkles\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })

  it('still injects a missing lucide icon import for JSX usage after an unterminated leading-quote apostrophe', () => {
    const appCode = `
function Hero() {
  return <p>'Tis the season for <Gift className="h-4 w-4" /> giving.</p>
}

export default function App() {
  return <Hero />
}
`
    const built = buildSandpackFiles({ '/App.tsx': appCode })
    const out = built['/App.tsx']
    expect(out).toMatch(/import\s*\{[^}]*\bGift\b[^}]*\}\s*from\s*['"]lucide-react['"]/)
  })
})

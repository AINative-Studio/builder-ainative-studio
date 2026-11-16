import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * #2034/#2053/#2057/#2059/#2061-class bug ported to jsx-fixer.ts's own 5
 * local comment/string-masking helpers (maskPreservingLength,
 * maskTemplatesAndComments, maskStringsAndCommentsPreservingLines,
 * maskStringsAndComments, maskPreservingOffsets), none of which had the
 * contraction/newline-boundary guard every other file in this bug class has
 * already been given.
 *
 * Concrete failure via stubNextOnlyModules() (uses maskPreservingOffsets):
 * a JSX-text contraction or decade-style apostrophe earlier in the file (an
 * ordinary thing in generated marketing copy) made the scanner treat it as
 * opening a real string literal, then search forward for ANY later same-quote
 * character to "close" it — often many lines away, past a real
 * `import { useRouter } from 'next/navigation'` statement. Everything in
 * between gets blanked in the mask as if it were string content, so
 * stubNextOnlyModules' own "is this match real code or a decoy?" check
 * (`masked.slice(offset, offset + match.length).trim() === ''`) wrongly
 * concludes the real import is a decoy and leaves it completely unstubbed.
 * Sandpack's react-ts template has no `next` dependency at all, so ANY
 * unresolvable next/* import fails the WHOLE compile (#1154) — not just this
 * one component.
 */
describe('jsx-fixer: comment/string-mask apostrophe desync (#2034/#2053-class)', () => {
  it('still stubs a real next/navigation import after a decade-style apostrophe in JSX text', () => {
    const code = [
      "import { useRouter } from 'next/navigation'",
      'function Hero() {',
      "  return <p>Retro styles from the '90s are back.</p>",
      '}',
      'export default function App() {',
      '  const router = useRouter()',
      '  return <Hero />',
      '}',
    ].join('\n')

    const fixed = fixJsxErrors(code)
    expect(fixed).not.toMatch(/from\s+['"]next\/navigation['"]/)
  })

  it('still stubs a real next/navigation import after a JSX-text contraction', () => {
    const code = [
      "import { useRouter } from 'next/navigation'",
      'function Hero() {',
      "  return <p>We're building something great. Don't worry.</p>",
      '}',
      'export default function App() {',
      '  const router = useRouter()',
      '  return <Hero />',
      '}',
    ].join('\n')

    const fixed = fixJsxErrors(code)
    expect(fixed).not.toMatch(/from\s+['"]next\/navigation['"]/)
  })
})

import { describe, it, expect } from 'vitest'
import { detectRootComponent, hasDefaultExport } from '@/lib/component-detector'

/**
 * #2057/#2053/#2034-class bug, independently present in
 * component-detector.ts's own `maskStringsAndComments` (never shared with
 * lib/build/bracket-scanner.ts's guarded version — see that file's #1893
 * audit note). A JSX-text apostrophe ("We're", "don't") earlier in a
 * generated file is misread as a real string-literal opener; with no other
 * `'`/`"` later in the file to close it, the fake "string" swallows every
 * real character through EOF — including the file's actual default-export
 * statement — as if it were string content, which `hasDefaultExport` and
 * `detectRootComponent` then can't see at all.
 *
 * This is the exact "duplicate default export" / blank-page / "Element type
 * is invalid" crash class component-detector.ts's own module doc (search
 * "Element type is invalid" above `hasDefaultExport`) exists to prevent: a
 * caller that sees `hasDefaultExport() === false` for a file that actually
 * has one synthesizes and appends a SECOND `export default`, a hard
 * SyntaxError.
 */
describe('component-detector apostrophe desync (#2057-class)', () => {
  const code = `
    function Footer() {
      return <p>We're here to help.</p>
    }

    export { Footer as default }
  `

  it('hasDefaultExport still sees a real export-as-default after an earlier JSX apostrophe', () => {
    expect(hasDefaultExport(code)).toBe(true)
  })

  it('detectRootComponent still finds the real default-exported component', () => {
    const result = detectRootComponent(code)
    expect(result.name).toBe('Footer')
  })

  it('a decade-style apostrophe inside JSX text does not swallow the rest of the file either', () => {
    const decadeCode = `
      function Banner() {
        return <p>Retro styles from the '90s are back.</p>
      }

      export default function Banner90s() {
        return <Banner />
      }
    `
    expect(hasDefaultExport(decadeCode)).toBe(true)
    expect(detectRootComponent(decadeCode).name).toBe('Banner90s')
  })
})

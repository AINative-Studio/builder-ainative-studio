import { describe, it, expect } from 'vitest'
import { isQualityApp } from '@/lib/showcase-quality'

/**
 * The showcase list quality gate moved server-side so generatedCode can be
 * stripped from the list payload (#58). isQualityApp must reproduce the old
 * client-side filter exactly.
 */
const bigPlain = 'const App = () => { return null }; '.repeat(200) // > 2000 chars, has const

describe('isQualityApp (showcase #58 quality gate)', () => {
  it('rejects when chatId is missing', () => {
    expect(isQualityApp(bigPlain, undefined)).toBe(false)
    expect(isQualityApp(bigPlain, '')).toBe(false)
  })

  it('rejects empty or short code', () => {
    expect(isQualityApp('', 'abc')).toBe(false)
    expect(isQualityApp('const x = 1', 'abc')).toBe(false)
  })

  it('accepts substantive plain code with a chatId', () => {
    expect(isQualityApp(bigPlain, 'abc123')).toBe(true)
  })

  it('rejects FILE-marker code whose largest section has no function/const', () => {
    const code = '// --- FILE: notes.txt\n' + 'lorem ipsum '.repeat(300)
    expect(isQualityApp(code, 'abc')).toBe(false)
  })

  it('accepts FILE-marker code whose largest section defines a function', () => {
    const code =
      '// --- FILE: readme.md\nhi\n' +
      '// --- FILE: App.js\nfunction App(){ return 1 }\n' + 'x '.repeat(1500)
    expect(isQualityApp(code, 'abc')).toBe(true)
  })

  /**
   * Real bug found live (this loop's overnight comment/string-blindness
   * sweep, same class as #1933/#1939/#1945/#1949/#1962/#1977/#1978/#1981/
   * #1983): isQualityApp used to gate on a raw, unmasked
   * `.includes()`/`.split()` with a marker regex not anchored to a full
   * line, so a decoy marker-shaped substring anywhere (including inside a
   * single-line string) could corrupt mainSection, wrongly rejecting a
   * genuinely substantive single-file app.
   */
  it('accepts substantive single-file code containing a decoy marker inside a string literal', () => {
    const code =
      "const note = '// --- FILE: App.tsx'\nfunction App(){ return 1 }\n" + 'x '.repeat(1200)
    expect(isQualityApp(code, 'abc')).toBe(true)
  })

  it('accepts substantive single-file code containing a decoy marker inside a block comment', () => {
    const code =
      '/**\n * Elsewhere we use the // --- FILE: path/to/file.tsx --- convention.\n */\n' +
      'function App(){ return 1 }\n' + 'x '.repeat(1200)
    expect(isQualityApp(code, 'abc')).toBe(true)
  })
})

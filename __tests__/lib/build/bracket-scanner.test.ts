import { describe, it, expect } from 'vitest'
import {
  findMatchingBracket,
  findMatchingParen,
  findMatchingBrace,
  findMatchingAngleBracket,
  findStringEnd,
  findBacktickEnd,
  maskComments,
} from '@/lib/build/bracket-scanner'

describe('bracket-scanner (#1710)', () => {
  describe('findMatchingParen', () => {
    it('finds the real close for a plain call', () => {
      const code = "foo(a, b)"
      expect(findMatchingParen(code, 3)).toBe(code.length - 1)
    })

    it('handles nested parens', () => {
      const code = "foo(bar(baz()), qux())"
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.lastIndexOf(')'))
    })

    it('is not fooled by a smiley emoticon inside a single-quoted string', () => {
      const code = "alert('Thanks :)')"
      const openIdx = code.indexOf('(')
      // The call's real close is the LAST ')', not the smiley's ')'.
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a frowny emoticon inside a double-quoted string', () => {
      const code = 'console.log("Checkout failed :(", user.email)'
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a stray paren inside a backtick template literal', () => {
      const code = "alert(`Thanks :)`)"
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a stray paren inside a ${} interpolation of a template literal', () => {
      // The interpolation itself contains a real, balanced call with its
      // own parens — those must be scanned as real code, not skipped.
      const code = 'alert(`Hello ${getName(user)} :)`)'
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a stray paren inside a string-literal default param value', () => {
      const code = "({ label = 'Thanks :)' }) => null"
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.indexOf(') =>'))
    })

    it('handles escaped quotes inside a string', () => {
      const code = String.raw`foo("a \" b )", c)`
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a bracket mentioned in a // line comment', () => {
      const code = "foo(a, // close with )\n  b)"
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a bracket mentioned in a /* */ block comment', () => {
      const code = "foo(a, /* this ) is not it */ b)"
      const openIdx = code.indexOf('(')
      expect(findMatchingParen(code, openIdx)).toBe(code.length - 1)
    })

    it('returns -1 for an unbalanced paren', () => {
      expect(findMatchingParen('foo(a, b', 3)).toBe(-1)
    })
  })

  describe('findMatchingBrace', () => {
    it('finds the real close across nested object-type braces', () => {
      const code = 'interface Props { theme: { primary: string } }'
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a brace mentioned in a comment', () => {
      const code = 'function f() { /* note: data-agent-manifest="true" appears in a { comment } here */ return 1 }'
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a __html arg with a nested brace', () => {
      const code = "dangerouslySetInnerHTML={{ __html: renderMarkup({ body: userInput }) }}"
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.length - 1)
    })
  })

  describe('findMatchingAngleBracket', () => {
    it('finds the real close across a nested generic', () => {
      const code = 'React.FC<{ metrics: Record<string, number> }>'
      const openIdx = code.indexOf('<')
      expect(findMatchingAngleBracket(code, openIdx)).toBe(code.length - 1)
    })

    it('is not fooled by a comparison-operator string-literal type', () => {
      const code = "React.FC<{ operator: '>' | '<' | '=' }>"
      const openIdx = code.indexOf('<')
      expect(findMatchingAngleBracket(code, openIdx)).toBe(code.length - 1)
    })
  })

  describe('findMatchingBracket (generic)', () => {
    it('supports an arbitrary bracket pair', () => {
      const code = '[a, [b, c], d]'
      expect(findMatchingBracket(code, 0, '[', ']')).toBe(code.length - 1)
    })
  })

  describe('findStringEnd / findBacktickEnd', () => {
    it('findStringEnd honors escapes', () => {
      const code = String.raw`"a \" b" rest`
      expect(findStringEnd(code, 0, '"')).toBe(code.indexOf('rest') - 2)
    })

    it('findBacktickEnd skips nested ${} interpolation containing its own backtick', () => {
      const code = '`outer ${`inner`} end` rest'
      expect(findBacktickEnd(code, 0)).toBe(code.indexOf(' rest') - 1)
    })

    it('findBacktickEnd handles doubly-nested ${} interpolation', () => {
      const code = '`a ${open ? `${extra}-open` : "closed"} b` rest'
      expect(findBacktickEnd(code, 0)).toBe(code.indexOf(' rest') - 1)
    })
  })

  /**
   * Real bug (overnight loop, 2026-11-08): a regex literal's unescaped
   * bracket-shaped characters (a `{`/`}` quantifier or character class) were
   * scanned as real bracket syntax, since this module had no regex-literal
   * opacity at all — the one source-code construct the module's own doc
   * comment doesn't mention alongside strings/templates/comments. A regex
   * with a genuinely unbalanced brace count inside it (e.g. a character
   * class matching a single literal `{`) could desync a caller's depth
   * count enough to return -1 (unbalanced) for a perfectly valid, balanced
   * function body — confirmed via `findMatchingBrace` on
   * `function Validate() { const re = /^[{]/; return re.test('{'); }`,
   * which returned -1 before this fix.
   */
  describe('regex literal opacity (2026-11-08)', () => {
    it('is not fooled by an unescaped single brace inside a regex character class', () => {
      const code = "function Validate() {\n  const re = /^[{]/;\n  return re.test('{');\n}"
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })

    it('is not fooled by a lone unescaped closing brace inside a regex character class', () => {
      const code = "function Validate() {\n  const re = /[}]$/;\n  return re.test(x);\n}"
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })

    it('is not fooled by a self-balancing {n,m} quantifier in a regex (sanity check, worked before too)', () => {
      const code = "function Validate() {\n  const re = /^\\d{3,5}$/;\n  return re.test(x);\n}"
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })

    it('still treats a plain division as division, not a regex literal', () => {
      const code = 'function Compute() { const half = total / 2; return { half }; }'
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })

    it('does not mistake a JSX closing tag\'s "</" for a regex literal start', () => {
      // If `</Foo>`'s `/` were ever treated as a regex opener, the scanner
      // would hunt forward for a closing `/` and swallow real JSX as regex
      // content — this must keep matching the component's real closing brace.
      const code = 'function App() { return <div><Foo>{x}</Foo></div>; }'
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })

    it('treats a regex literal after `return` as opaque even with an unbalanced brace inside', () => {
      const code = 'function Check(s) { return /^[{]/.test(s); }'
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })

    it('treats a regex literal passed as a call argument as opaque', () => {
      const code = "function Strip(s) { return s.replace(/[{]/g, ''); }"
      const openIdx = code.indexOf('{')
      expect(findMatchingBrace(code, openIdx)).toBe(code.lastIndexOf('}'))
    })
  })

  /**
   * #2053 — an apostrophe inside plain JSX text (an English contraction like
   * "We're", "Don't", "Let's") is not a string delimiter at all, but
   * maskComments() treated ANY bare `'` as opening a real string literal and
   * scanned forward to the next `'` anywhere later in the file — silently
   * copying through everything in between, including a real `//`/`/* *\/`
   * comment this function exists to blank, as unmodified "string" content.
   * Same root cause PR #2034 fixed in the separate build-files.ts copy; this
   * is the shared canonical copy completeness-gate.ts and 7+ other files
   * delegate to.
   */
  describe('maskComments — apostrophe in JSX text does not desync the real comment scan (#2053)', () => {
    it('still blanks a real line comment that comes after a contraction elsewhere in the file', () => {
      const code = [
        "const msg = 'We are open';",
        "// real comment that must be blanked",
        'const x = 1;',
      ].join('\n')
      const masked = maskComments(code)
      expect(masked).not.toContain('real comment')
      expect(masked).toContain('const x = 1;')
    })

    it('the exact repro from #2053: a contraction before a disabled JSX import comment no longer swallows the comment as live code', () => {
      const code = [
        "import Header from './components/Header'",
        'export default function App() {',
        '  return (',
        '    <div>',
        '      <Header />',
        "      <p>We're open 24/7 for all your needs.</p>",
        '      {/* <Footer /> */}',
        "      {/* import Footer from './components/Footer' */}",
        '    </div>',
        '  )',
        '}',
      ].join('\n')
      const masked = maskComments(code)
      // The commented-out import line must be fully blanked (spaces), not
      // copied through as live text — confirming the real /* */ comment
      // scan actually ran instead of being skipped over as "string content."
      expect(masked).not.toContain("import Footer from './components/Footer'")
      expect(masked).not.toContain('<Footer />')
      // The genuinely live code around it must be untouched.
      expect(masked).toContain("import Header from './components/Header'")
      expect(masked).toContain('<Header />')
    })

    it('a real string literal is still masked correctly when no contraction is involved', () => {
      const code = "const label = 'hello world'; // trailing comment"
      const masked = maskComments(code)
      expect(masked).toContain("'hello world'")
      expect(masked).not.toContain('trailing comment')
    })

    it('does not break a real string that legitimately starts right after a word character via string concatenation', () => {
      // `x'y'` is not valid JS on its own, but this guards the CHARACTER
      // immediately before the quote, not the token before it — a real
      // string following an operator (not a bare identifier char) must
      // still open normally.
      const code = "const s = x + 'real string'; // comment"
      const masked = maskComments(code)
      expect(masked).toContain("'real string'")
      expect(masked).not.toContain('comment')
    })

    it('handles multiple contractions in the same line without losing sync', () => {
      const code = [
        "const msg = \"Don't worry, we're here, let's go\";",
        '// comment after multiple contractions',
      ].join('\n')
      const masked = maskComments(code)
      expect(masked).not.toContain('comment after multiple contractions')
    })

    it('a double-quoted string is unaffected — the apostrophe guard only applies to the single-quote character', () => {
      const code = 'const s = "it\'s fine"; // comment'
      const masked = maskComments(code)
      expect(masked).not.toContain('// comment'.slice(2))
    })
  })

  /**
   * #2055 — the #2034/#2053 apostrophe-desync bug class also affects
   * findMatchingBracket (and thus findMatchingParen/findMatchingBrace/
   * findMatchingAngleBracket), which never got the guard maskComments did:
   * ANY bare `'`/`"` is treated as a real string open, so a lone contraction
   * with no second quote anywhere later in the scanned span makes the whole
   * bracket match falsely report "unbalanced" (-1) for perfectly valid code.
   */
  describe('findMatchingBracket — apostrophe in JSX text does not false-positive "unbalanced" (#2055)', () => {
    it('a lone contraction with no second quote in the snippet no longer makes findMatchingBrace report unbalanced', () => {
      const code = ["{", "  cond && <p>We're done here.</p>", "}"].join('\n')
      expect(findMatchingBrace(code, 0)).toBe(code.length - 1)
    })

    it('a lone contraction inside a paren-wrapped JSX expression no longer makes findMatchingParen report unbalanced', () => {
      const code = ["(", "  <p>Don't worry, it's covered.</p>", ")"].join('\n')
      expect(findMatchingParen(code, 0)).toBe(code.length - 1)
    })

    it('a real unmatched/unterminated string still reports unbalanced (truncation case unchanged)', () => {
      const code = "{ const x = 'this string never closes"
      expect(findMatchingBrace(code, 0)).toBe(-1)
    })
  })

  /**
   * #2055 — a `'`/`"` whose only candidate closing quote is on a LATER LINE
   * was never a real string open either: a real single/double-quoted JS
   * string literal can't contain a raw newline (that's a syntax error
   * outside template literals). A decade reference like "the '90s" with no
   * closing `'` until some unrelated string many lines later used to make
   * both findMatchingBracket and maskComments skip everything in between —
   * including real comments or real bracket characters — as "string
   * content."
   */
  describe('newline-spanning fake quote (decade apostrophe etc.) (#2055)', () => {
    it('maskComments still blanks a real comment after a decade-style apostrophe with no same-line close', () => {
      const code = [
        "<p>Back in the '90s, we built this differently.</p>",
        '',
        '// REAL COMMENT should be blanked',
        "const secret = 'token-xyz'",
      ].join('\n')
      const masked = maskComments(code)
      expect(masked).not.toContain('REAL COMMENT should be blanked')
      expect(masked).toContain("const secret = 'token-xyz'")
    })

    it('findMatchingBrace is not desynced by a decade-style apostrophe between the braces', () => {
      const code = [
        '{',
        "  cond && <p>Back in the '90s things were different.</p>",
        '}',
      ].join('\n')
      expect(findMatchingBrace(code, 0)).toBe(code.length - 1)
    })

    it('a real same-line single-quoted string is unaffected by the newline guard', () => {
      const code = "const label = 'hello world'; // trailing comment"
      const masked = maskComments(code)
      expect(masked).toContain("'hello world'")
      expect(masked).not.toContain('trailing comment')
    })
  })
})

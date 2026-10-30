import { describe, it, expect } from 'vitest'
import {
  findMatchingBracket,
  findMatchingParen,
  findMatchingBrace,
  findMatchingAngleBracket,
  findStringEnd,
  findBacktickEnd,
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
})

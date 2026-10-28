import { describe, it, expect } from 'vitest'
import { convertTemplateLiteralAttrsToConcat } from '@/lib/build/template-literal-to-concat'

describe('convertTemplateLiteralAttrsToConcat', () => {
  it('THE BUG: a ternary interpolation used to corrupt the whole className (operator precedence)', () => {
    const code =
      'className={`fixed z-40 top-0 left-0 h-full w-64 bg-[#18181f] flex flex-col transform transition-transform ${sidebarOpen ? \'translate-x-0\' : \'-translate-x-full\'}`}'
    const out = convertTemplateLiteralAttrsToConcat(code)

    // The fix: the interpolated ternary must be parenthesized, so `+`
    // concatenates the WHOLE ternary result, not just its first operand.
    expect(out).toContain("+ (sidebarOpen ? 'translate-x-0' : '-translate-x-full')")

    // Evaluate the actual runtime semantics to prove the fix, not just the
    // string shape: with the OLD (broken) join, `"prefix " + sidebarOpen ?
    // a : b` always evaluates to `a` regardless of sidebarOpen. The FIXED
    // expression must evaluate differently for true vs false and must
    // always retain the static prefix.
    const evalClassName = (sidebarOpen: boolean) => {
      const match = out.match(/=\{(.+)\}$/)
      // eslint-disable-next-line no-new-func
      return new Function('sidebarOpen', `return ${match![1]}`)(sidebarOpen)
    }
    const whenOpen = evalClassName(true)
    const whenClosed = evalClassName(false)
    expect(whenOpen).toContain('fixed z-40 top-0 left-0 h-full w-64')
    expect(whenClosed).toContain('fixed z-40 top-0 left-0 h-full w-64')
    expect(whenOpen).toContain('translate-x-0')
    expect(whenOpen).not.toContain('-translate-x-full')
    expect(whenClosed).toContain('-translate-x-full')
  })

  it('handles a plain (non-ternary) interpolation unchanged in behavior', () => {
    const code = 'className={`w-10 h-10 ${color} rounded`}'
    const out = convertTemplateLiteralAttrsToConcat(code)
    const match = out.match(/=\{(.+)\}$/)
    // eslint-disable-next-line no-new-func
    const result = new Function('color', `return ${match![1]}`)('bg-red-500')
    expect(result).toBe('w-10 h-10 bg-red-500 rounded')
  })

  it('handles multiple interpolations in one attribute', () => {
    const code = 'className={`a ${x} b ${y ? "c" : "d"} e`}'
    const out = convertTemplateLiteralAttrsToConcat(code)
    const match = out.match(/=\{(.+)\}$/)
    // eslint-disable-next-line no-new-func
    const result = new Function('x', 'y', `return ${match![1]}`)('X', true)
    expect(result).toBe('a X b c e')
  })

  it('leaves a template literal with no interpolation as a single-line template literal', () => {
    const code = 'className={`fixed\n  top-0\n  left-0`}'
    const out = convertTemplateLiteralAttrsToConcat(code)
    expect(out).toBe('className={`fixed top-0 left-0`}')
  })

  it('applies to style attributes the same as className', () => {
    const code = "style={`color: ${active ? 'red' : 'blue'}`}"
    const out = convertTemplateLiteralAttrsToConcat(code)
    expect(out).toContain("(active ? 'red' : 'blue')")
  })

  it('handles a logical-AND interpolation correctly parenthesized', () => {
    const code = 'className={`base ${isActive && "active"}`}'
    const out = convertTemplateLiteralAttrsToConcat(code)
    expect(out).toContain('+ (isActive && "active")')
    const match = out.match(/=\{(.+)\}$/)
    // eslint-disable-next-line no-new-func
    const whenTrue = new Function('isActive', `return ${match![1]}`)(true)
    expect(whenTrue).toBe('base active')
  })

  it('is a no-op on an already-correct plain string className', () => {
    const code = 'className="fixed top-0 left-0"'
    expect(convertTemplateLiteralAttrsToConcat(code)).toBe(code)
  })

  it('#1643: a nested object-literal arg inside the interpolation (e.g. cn({...})) does not truncate the expression', () => {
    // Real bug: the old flat `\$\{[^}]+\}` scan for the interpolation's
    // extent stopped at the FIRST `}` — the one closing the nested object
    // literal argument to cn(), not the real end of the `${}` — splicing
    // static text and expression fragments at the wrong boundary and
    // producing a hard SyntaxError (unbalanced parens/braces).
    const code = 'className={`base ${isActive ? cn({active: true}) : "x"} end`}'
    const out = convertTemplateLiteralAttrsToConcat(code)
    expect(out).toContain('+ (isActive ? cn({active: true}) : "x")')

    const cn = (opts: Record<string, boolean>) =>
      Object.keys(opts).filter((k) => opts[k]).join(' ')
    const evalClassName = (isActive: boolean) => {
      const match = out.match(/=\{(.+)\}$/)
      // eslint-disable-next-line no-new-func
      return new Function('isActive', 'cn', `return ${match![1]}`)(isActive, cn)
    }
    expect(evalClassName(true)).toBe('base active end')
    expect(evalClassName(false)).toBe('base x end')
  })

  it('#1643: a nested template literal inside the interpolation is handled, not left unconverted', () => {
    const code = 'className={`base ${open ? `${extra}-open` : "closed"} end`}'
    const out = convertTemplateLiteralAttrsToConcat(code)
    expect(out).toContain('+ (open ? `${extra}-open` : "closed")')

    const evalClassName = (open: boolean, extra: string) => {
      const match = out.match(/=\{(.+)\}$/)
      // eslint-disable-next-line no-new-func
      return new Function('open', 'extra', `return ${match![1]}`)(open, extra)
    }
    expect(evalClassName(true, 'wide')).toBe('base wide-open end')
    expect(evalClassName(false, 'wide')).toBe('base closed end')
  })

  it('#1643: a genuinely unbalanced interpolation is left untouched rather than mis-split', () => {
    const code = 'className={`base ${isActive ? cn({active: true : "x"} end`}'
    expect(convertTemplateLiteralAttrsToConcat(code)).toBe(code)
  })
})

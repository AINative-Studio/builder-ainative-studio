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
})

import { describe, it, expect } from 'vitest'
import { stripGradients } from '@/lib/gradient-blocker'

/**
 * Regression: stripGradients() used to run its gradient-class regexes
 * (`from-\w+-\d+`, `to-\w+-\d+`, `via-\w+-\d+`, `bg-gradient-\w+`) against the
 * ENTIRE file with no scoping, so any substring elsewhere in a generated file
 * that happened to match the same shape — a real href/slug, visible page
 * copy, a comment — was silently deleted too, even though none of it has
 * anything to do with a Tailwind gradient class.
 *
 * Confirmed live on unpatched code:
 *   '<a href="/guides/add-to-cart-2">Add to cart</a>'
 *     -> '<a href="/guides/add-">Add to cart</a>'               (broken link)
 *   '<span>{"Upgrade path: from-basic-2"}</span>'
 *     -> '<span>{"Upgrade path: "}</span>'                      (truncated copy)
 */
describe('stripGradients only touches real className attribute values', () => {
  it('does not truncate a href whose slug happens to match the gradient shape', () => {
    const code = '<a href="/guides/add-to-cart-2">Add to cart</a>'
    expect(stripGradients(code)).toBe(code)
  })

  it('does not truncate a href with a from-*-N shaped slug', () => {
    const code = '<a href="/blog/from-idea-to-launch-2">Our story</a>'
    expect(stripGradients(code)).toBe(code)
  })

  it('does not delete real displayed text that matches the gradient shape', () => {
    const code = '<span>{"Upgrade path: from-basic-2"}</span>'
    expect(stripGradients(code)).toBe(code)
  })

  it('does not mangle a comment that merely mentions gradient classes', () => {
    const code = '// gradient from-blue-500 to-purple-600 banned per design review'
    expect(stripGradients(code)).toBe(code)
  })

  it('still strips a real gradient from a plain double-quoted className', () => {
    const code = '<div className="flex from-blue-500 to-purple-600 p-4">x</div>'
    const out = stripGradients(code)
    expect(out).not.toMatch(/from-blue-500|to-purple-600/)
    expect(out).toContain('className="flex p-4"')
  })

  it('still strips a real gradient from a template-literal className', () => {
    const code = '<div className={`flex from-blue-500 to-purple-600`}>x</div>'
    const out = stripGradients(code)
    expect(out).not.toMatch(/from-blue-500|to-purple-600/)
  })

  it('still strips a real gradient nested inside a cn() call', () => {
    const code = "<div className={cn('flex', isActive && 'from-blue-500 to-purple-600')}>x</div>"
    const out = stripGradients(code)
    expect(out).not.toMatch(/from-blue-500|to-purple-600/)
    expect(out).toContain("cn('flex', isActive && '')")
  })

  it('still strips a real gradient inside a ternary className expression', () => {
    const code = "<div className={active ? 'from-blue-500 to-purple-600' : 'bg-gray-100'}>x</div>"
    const out = stripGradients(code)
    expect(out).not.toMatch(/from-blue-500|to-purple-600/)
    expect(out).toContain("active ? '' : 'bg-gray-100'")
  })

  it('leaves code with no className untouched', () => {
    const code = 'const x = "from-basic-2 to-pro-3"'
    expect(stripGradients(code)).toBe(code)
  })

  it('collapses an emptied className attribute the same way as before', () => {
    const code = '<div className="from-blue-500 to-purple-600">x</div>'
    const out = stripGradients(code)
    expect(out).not.toContain('className=""')
    expect(out).toBe('<div >x</div>')
  })
})

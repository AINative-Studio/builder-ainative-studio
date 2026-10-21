import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Export-side counterpart to stubUnresolvableBareImports (#1179). Sandpack
 * resolves the specifier on `export ... from 'pkg'` exactly like a plain
 * `import ... from 'pkg'`, so an unresolvable package reached via a
 * re-export carries the same whole-compile-crash risk, but none of the
 * import-only regexes in stubUnresolvableBareImports ever match this
 * syntax — confirmed gap, #1181.
 */
describe('stubUnresolvableReExports', () => {
  it('stubs named re-exports of an unknown package as local const declarations', () => {
    const code = "export { useForm, Controller } from 'react-hook-form'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]react-hook-form['"]/)
    expect(out).toMatch(/export const useForm = new Proxy/)
    expect(out).toMatch(/export const Controller = new Proxy/)
  })

  it('honors an alias on a named re-export, self-referencing the declared local name (not the package\'s original export name, which this file never declares)', () => {
    const code = "export { useForm as useReactHookForm } from 'react-hook-form'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]react-hook-form['"]/)
    expect(out).toMatch(/export const useReactHookForm = new Proxy/)
    expect(out).not.toMatch(/export const useForm /)

    // Real regression check (#1181 follow-up): the stub used to self-reference
    // `useForm` — the package's original export name — which is never
    // actually declared anywhere in this file, so calling the stub threw
    // `ReferenceError: useForm is not defined`.
    const constLine = out.match(/export const useReactHookForm = new Proxy[^\n]*/)![0].replace(/^export /, '')
    const useReactHookForm = new Function(`${constLine}\nreturn useReactHookForm`)()
    expect(() => useReactHookForm()).not.toThrow()
  })

  it('re-exports `default` as this module\'s own default export, not an invalid `export const default`, and is runtime-executable', () => {
    const code = "export { default } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/export const default/)
    expect(out).toMatch(/export default \(function \(\) \{ const __default = new Proxy/)

    // Real regression check: `default` is a reserved word, so a stub that
    // used it as a bare value expression (`get: () => default`) was a
    // SyntaxError, not just an unlikely edge case — confirmed by actually
    // evaluating the generated expression.
    const line = out.match(/^export default .*$/m)![0]
    const expr = line.replace(/^export default /, '').replace(/;$/, '')
    expect(() => new Function(`return ${expr}`)()).not.toThrow()
  })

  it('re-exports `x as default` as this module\'s own default export, and is runtime-executable', () => {
    const code = "export { Thing as default } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/export default \(function \(\) \{ const __default = new Proxy/)
    const line = out.match(/^export default .*$/m)![0]
    const expr = line.replace(/^export default /, '').replace(/;$/, '')
    expect(() => new Function(`return ${expr}`)()).not.toThrow()
  })

  it('drops a type-only named re-export entirely', () => {
    const code = "export type { Variants } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out.trim()).toBe('')
  })

  it('drops an inline `type` specifier mixed with value specifiers, stubbing only the value ones, and the result is valid executable JS', () => {
    // `export { type Variants, motion } from 'framer-motion'` — left
    // unhandled, `type` ends up spliced into the exported const's name
    // (`export const type Variants = ...`), a SyntaxError.
    const code = "export { type Variants, motion } from 'framer-motion'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/\btype Variants\b/)
    expect(out).not.toMatch(/const Variants/)
    const constLine = out.match(/export const motion = new Proxy[^\n]*/)![0].replace(/^export /, '')
    expect(() => new Function(constLine)()).not.toThrow()
  })

  it('drops `export * from` entirely — the re-exported binding names are unknowable from this file', () => {
    const code = "export * from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out.trim()).toBe('')
  })

  it('stubs `export * as Name from` as a local namespace binding', () => {
    const code = "export * as Icons from 'some-icon-lib'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]some-icon-lib['"]/)
    expect(out).toMatch(/export const Icons = new Proxy/)
  })

  it('leaves a re-export of an allowlisted package untouched', () => {
    const code = "export { Heart, Search } from 'lucide-react'"
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  it('leaves a re-export of a relative/local module untouched', () => {
    const code = "export { Thing } from './components/thing'"
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  it('leaves code with no re-export statements untouched', () => {
    const code = "import { useState } from 'react'\nexport default function App(){ return null }"
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  it('produces a valid, runtime-executable JSX-tag-shaped stub for a re-exported icon used as a JSX tag elsewhere', () => {
    const code = "export { Icon } from 'some-icon-lib'\nfunction X() { return <Icon /> }"
    const out = fixJsxErrors(code)
    const constLine = out.match(/export const Icon = new Proxy[^\n]*/)![0].replace(/^export /, '')

    const Icon = new Function(`${constLine}\nreturn Icon`)()
    expect(Icon({ children: 'hi' })).toBe('hi')
    expect(Icon({})).toBe(null)
  })
})

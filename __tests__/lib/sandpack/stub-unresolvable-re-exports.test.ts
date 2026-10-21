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

  it('honors an alias on a named re-export', () => {
    const code = "export { useForm as useReactHookForm } from 'react-hook-form'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]react-hook-form['"]/)
    expect(out).toMatch(/export const useReactHookForm = new Proxy/)
    expect(out).not.toMatch(/export const useForm /)
  })

  it('re-exports `default` as this module\'s own default export, not an invalid `export const default`', () => {
    const code = "export { default } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/export const default/)
    expect(out).toMatch(/export default new Proxy/)
  })

  it('re-exports `x as default` as this module\'s own default export', () => {
    const code = "export { Thing as default } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out).toMatch(/export default new Proxy/)
  })

  it('drops a type-only named re-export entirely', () => {
    const code = "export type { Variants } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out.trim()).toBe('')
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

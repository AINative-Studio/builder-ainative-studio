import { describe, it, expect } from 'vitest'
import { fixJsxErrors } from '@/lib/sandpack/jsx-fixer'

/**
 * Generic safety net (#1179) for ANY bare import of a package Sandpack
 * doesn't actually have available (see components/chat/sandpack-preview.tsx's
 * customSetup.dependencies for the real allowlist). Sandpack's bundler fails
 * the ENTIRE compile on any unresolvable import anywhere in the file tree,
 * regardless of reachability (#1124/#1125) — this had already been fixed one
 * package at a time (next/image, next/navigation, framer-motion, react-icons,
 * legacy pages router, #1151/#1154/#1174/#1177/#1099) before this generic
 * fallback, which catches everything else in that same bug class
 * (date-fns, zod, axios, uuid, react-hook-form, styled-components, etc.)
 * without needing a new issue+PR per package discovered.
 */
describe('stubUnresolvableBareImports', () => {
  it('stubs named imports of an unknown package as const declarations, dropping the import', () => {
    const code = "import { useForm, Controller } from 'react-hook-form'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]react-hook-form['"]/)
    expect(out).toMatch(/const useForm = new Proxy/)
    expect(out).toMatch(/const Controller = new Proxy/)
  })

  it('stubs a default import', () => {
    const code = "import axios from 'axios'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]axios['"]/)
    expect(out).toMatch(/const axios = new Proxy/)
  })

  it('stubs a namespace import', () => {
    const code = "import * as Icons from '@heroicons/react/24/solid'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]@heroicons\/react\/24\/solid['"]/)
    expect(out).toMatch(/const Icons = new Proxy/)
  })

  it('stubs a default + named combination, honoring aliases', () => {
    const code = "import DatePicker, { registerLocale as reg } from 'react-datepicker'"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/from ['"]react-datepicker['"]/)
    expect(out).toMatch(/const DatePicker = new Proxy/)
    expect(out).toMatch(/const reg = new Proxy/)
  })

  it('drops a side-effect-only import of an unresolvable package entirely', () => {
    const code = "import 'react-datepicker/dist/react-datepicker.css'\nexport default function App() { return null }"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/react-datepicker/)
  })

  it('drops type-only imports entirely rather than stubbing a runtime value', () => {
    const code = "import type { Variants } from 'some-unknown-lib'"
    const out = fixJsxErrors(code)
    expect(out.trim()).toBe('')
  })

  it('drops an inline `type` specifier mixed with value specifiers, stubbing only the value ones, and the result is valid executable JS', () => {
    // `import { type Config, init } from 'some-unknown-lib'` — a plausible
    // real-world shape for ANY package without its own dedicated stub (not
    // framer-motion, whose `motion` export gets #1178's dedicated,
    // JSX-returning stub instead — this generic fallback never sees it, since
    // that more specific stub runs first and already consumed the import).
    // Left unhandled, `type` ends up spliced into the generated identifier
    // (`const type Config = ...`), a SyntaxError this fallback would
    // introduce on its own, worse than the crash it exists to prevent.
    const code = "import { type Config, init } from 'some-unknown-lib'\ninit()"
    const out = fixJsxErrors(code)
    expect(out).not.toMatch(/\btype Config\b/)
    expect(out).not.toMatch(/const Config/)
    const constLine = out.match(/const init = new Proxy[^\n]*/)![0]
    expect(() => new Function(constLine)()).not.toThrow()
  })

  it('leaves allowlisted package imports (react, clsx, lucide-react, recharts, scoped stripe) untouched', () => {
    const code = [
      "import React, { useState } from 'react'",
      "import { clsx } from 'clsx'",
      "import { Heart } from 'lucide-react'",
      "import { LineChart } from 'recharts'",
      "import { loadStripe } from '@stripe/stripe-js'",
    ].join('\n')
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  it('leaves relative and local imports untouched (handled elsewhere, not this fallback)', () => {
    const code = "import { Thing } from './components/thing'\nimport Helper from '../lib/helper'"
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  it('leaves code with no bare unresolvable imports untouched', () => {
    const code = "import { useState } from 'react'\nexport default function App(){ return null }"
    expect(fixJsxErrors(code).trim()).toBe(code.trim())
  })

  it('hook/utility-shaped stub (never used as a JSX tag): calling it is destructurable/chainable at runtime, never throws', () => {
    // No `<useForm` usage anywhere in this file, so it's classified as
    // hook-shaped, not component-shaped.
    const code = "import { useForm } from 'react-hook-form'\nconst { register, handleSubmit } = useForm()"
    const out = fixJsxErrors(code)
    const constLine = out.match(/const useForm = new Proxy[^\n]*/)![0]

    // Evaluate the generated declaration directly (plain JS, no JSX in the
    // stub expression itself) — exercises REAL runtime behavior, not just
    // string shape.
    const useForm = new Function(`${constLine}\nreturn useForm`)()
    const { register, handleSubmit } = useForm()
    expect(typeof register).toBe('function')
    expect(typeof handleSubmit).toBe('function')
  })

  it('JSX-tag-shaped stub (used as `<Icon>`/`<Icon.Solid>` elsewhere): calling it returns valid React children, never the function itself', () => {
    const code = "import Icon from 'some-icon-lib'\nfunction X() { return <Icon.Solid /> }"
    const out = fixJsxErrors(code)
    const constLine = out.match(/const Icon = new Proxy[^\n]*/)![0]

    const Icon = new Function(`${constLine}\nreturn Icon`)()

    // What React actually does when rendering a function component.
    expect(Icon({ children: 'hi' })).toBe('hi')
    expect(Icon({})).toBe(null) // self-closing tag, no children — never the stub itself

    // Nested property access (compound-component usage, e.g. Icon.Solid)
    // stays chainable and is itself component-shaped.
    expect(typeof Icon.Solid).toBe('function')
    expect(Icon.Solid({ children: 'ok' })).toBe('ok')
  })
})

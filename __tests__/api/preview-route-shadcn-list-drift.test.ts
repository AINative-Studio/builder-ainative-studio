import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Component-name list drift, round 3 (same root-cause class as
 * #1277/#1278/#1281/#1283): the live preview route maintains THREE of its
 * own independent copies of "which shadcn component names are available",
 * and all three had fallen behind lib/sandpack/shadcn-bundle.ts's real
 * exports — missing Switch, Textarea, Slider, Tooltip (+Provider/Trigger/
 * Content), DropdownMenu (+Trigger/Content/Item/Separator/Label), and
 * ScrollArea/ScrollBar:
 *
 *  1. `knownComponents` (the "unknown JSX tag → fallback plain div" safety
 *     net) — a real component missing here silently got a non-functional
 *     placeholder div instead of ever being flagged.
 *  2. The `window.ShadcnComponents` destructure + `allComponents` check
 *     object — a name missing here never got copied onto `window` by the
 *     `Object.keys(allComponents).forEach` loop (the #197/Dispatch fix a
 *     few lines below it), so it stayed truly undefined for the compiled
 *     app's separate global-scope <script> and crashed with "Element type
 *     is invalid" / "X is not defined" the instant a generated component
 *     used it.
 *  3. public/shadcn-components.js — the actual browser-loaded bundle that
 *     populates `window.ShadcnComponents` in the first place never defined
 *     these components at all, so even a correct destructure above would
 *     still have resolved to `undefined`.
 */
describe('/api/preview/[id] route — shadcn component-name list drift (round 3)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'app/api/preview/[id]/route.ts'),
    'utf8',
  )

  const driftedNames = [
    'Switch', 'Textarea', 'Slider',
    'Tooltip', 'TooltipProvider', 'TooltipTrigger', 'TooltipContent',
    'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem',
    'DropdownMenuSeparator', 'DropdownMenuLabel',
    'ScrollArea', 'ScrollBar',
  ]

  it('the unknown-JSX-tag fallback safety net (`knownComponents`) covers the full shadcn surface', () => {
    const knownComponentsBlock = source.slice(
      source.indexOf('const knownComponents = new Set(['),
      source.indexOf('])', source.indexOf('const knownComponents = new Set([')),
    )
    for (const name of driftedNames) {
      expect(knownComponentsBlock, `knownComponents is missing '${name}'`).toMatch(
        new RegExp(`['"]${name}['"]`),
      )
    }
  })

  it('the window.ShadcnComponents destructure covers the full shadcn surface', () => {
    const destructureBlock = source.slice(
      source.indexOf('window.ShadcnComponents || {}') - 1500,
      source.indexOf('window.ShadcnComponents || {}'),
    )
    for (const name of driftedNames) {
      expect(destructureBlock, `ShadcnComponents destructure is missing '${name}'`).toMatch(
        new RegExp(`\\b${name}\\b`),
      )
    }
  })

  it('the allComponents check object (copied onto window for the compiled app) covers the full shadcn surface', () => {
    const allComponentsBlock = source.slice(
      source.indexOf('const allComponents = {'),
      source.indexOf('};', source.indexOf('const allComponents = {')),
    )
    for (const name of driftedNames) {
      expect(allComponentsBlock, `allComponents is missing '${name}'`).toMatch(
        new RegExp(`\\b${name}\\b`),
      )
    }
  })
})

describe('public/shadcn-components.js — defines + exports the full shadcn surface', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/shadcn-components.js'),
    'utf8',
  )

  const driftedNames = [
    'Switch', 'Textarea', 'Slider',
    'Tooltip', 'TooltipProvider', 'TooltipTrigger', 'TooltipContent',
    'DropdownMenu', 'DropdownMenuTrigger', 'DropdownMenuContent', 'DropdownMenuItem',
    'DropdownMenuSeparator', 'DropdownMenuLabel',
    'ScrollArea', 'ScrollBar', 'Skeleton',
  ]

  it('defines a component (const <Name> = ...) for each drifted name', () => {
    for (const name of driftedNames) {
      expect(source, `no 'const ${name} =' definition found`).toMatch(
        new RegExp(`const ${name} = `),
      )
    }
  })

  it('exposes each drifted name on window.ShadcnComponents', () => {
    const exportBlock = source.slice(
      source.indexOf('window.ShadcnComponents = {'),
      source.indexOf('};', source.indexOf('window.ShadcnComponents = {')),
    )
    for (const name of driftedNames) {
      expect(exportBlock, `window.ShadcnComponents export is missing '${name}'`).toMatch(
        new RegExp(`\\b${name}\\b,`),
      )
    }
  })

  it('actually executes in a browser-like context and renders real (non-placeholder) components', () => {
    // Minimal React stub sufficient to exercise createElement/useState/
    // Children.map without pulling in the real react package (this file
    // runs as a bare <script> in the browser, with the real React global
    // already on `window` — we only need enough of its surface to prove
    // these components are real functions, not silently-undefined stubs).
    const elements: any[] = []
    const fakeReact = {
      createElement: (type: any, props: any, ...children: any[]) => {
        const el = { type, props, children }
        elements.push(el)
        return el
      },
      useState: (initial: any) => [initial, () => {}],
      Children: { map: (children: any, fn: any) => (Array.isArray(children) ? children.map(fn) : children ? [fn(children)] : children) },
      cloneElement: (el: any, extra: any) => ({ ...el, props: { ...el.props, ...extra } }),
    }
    const fakeWindow: any = {}
    const fn = new Function('window', 'React', source + '\nreturn window.ShadcnComponents;')
    const ShadcnComponents = fn(fakeWindow, fakeReact)

    expect(ShadcnComponents).toBeTruthy()
    for (const name of driftedNames) {
      expect(typeof ShadcnComponents[name], `${name} should be a real component function`).toBe('function')
    }

    // Spot-check one renders real markup, not an empty/placeholder div.
    const switchEl = ShadcnComponents.Switch({ checked: true })
    expect(switchEl.props.role).toBe('switch')
    expect(switchEl.props['aria-checked']).toBe(true)
  })
})

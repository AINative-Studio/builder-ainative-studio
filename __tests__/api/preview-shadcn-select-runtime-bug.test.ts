// @vitest-environment jsdom
import fs from 'fs'
import path from 'path'
import { describe, it, expect, afterEach } from 'vitest'
import * as React from 'react'
import { act } from 'react'
import * as ReactDOMClient from 'react-dom/client'

;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true

/**
 * Real-world bug found while live-testing a paying founder's generated app
 * (track:app, "ledra" — a services marketplace with a "Post a Project" form).
 * The form's shadcn `<Select>` for "Service Type" appeared to work (clicking
 * an option highlighted it) but silently never committed: the trigger's
 * visible text never updated and the options panel never closed, which left
 * the real submit guard (`!formData.serviceType`) permanently tripped so the
 * whole form could never be submitted.
 *
 * Confirmed via direct inspection that ledra's generated source itself was
 * completely correct (`<Select value={formData.serviceType}
 * onValueChange={v => updateField('serviceType', v)}>` with a properly bound
 * SelectTrigger/SelectValue/SelectContent/SelectItem) -- the defect was in
 * this file, the single-file Babel preview's own Select implementation,
 * which is a separate, independently-maintained copy from the Sandpack
 * multi-file bundle (lib/sandpack/shadcn-bundle.ts) and had drifted to a
 * broken prop-drilling design:
 *   - SelectValue read its own `value` prop, but Select() only ever cloned
 *     props onto its DIRECT children (SelectTrigger, SelectContent) -- never
 *     onto SelectValue, SelectTrigger's own child two levels down -- so the
 *     trigger text could never reflect a selection.
 *   - SelectContent's visibility was supposed to be gated by `isOpen`, but
 *     Select()'s `React.Children.map` only skipped CLONING props when closed
 *     and still returned the original child unchanged -- so the options
 *     panel never actually left the DOM.
 *
 * Fixed by switching to the same context-based pattern already proven
 * correct in lib/sandpack/shadcn-bundle.ts, so SelectValue/SelectContent read
 * live selection/open state directly instead of depending on Select() prop-
 * cloning the right element at the right depth.
 */
describe('public/shadcn-components.js — Select commits a real selection (ledra regression)', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'public/shadcn-components.js'),
    'utf8',
  )

  function loadShadcnComponents() {
    const fakeWindow: any = {}
    // eslint-disable-next-line no-new-func
    const fn = new Function('window', 'React', `${source}\nreturn window.ShadcnComponents;`)
    return fn(fakeWindow, React)
  }

  let container: HTMLDivElement | null = null
  afterEach(() => {
    if (container) {
      document.body.removeChild(container)
      container = null
    }
  })

  it('reflects the selected value in the trigger and closes the panel, exactly like ledra\'s real Select usage', async () => {
    const { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } = loadShadcnComponents()

    container = document.createElement('div')
    document.body.appendChild(container)

    let latestValue = ''
    function Harness() {
      const [value, setValue] = React.useState('')
      latestValue = value
      return React.createElement(
        Select,
        { value, onValueChange: (v: string) => setValue(v) },
        React.createElement(SelectTrigger, {}, React.createElement(SelectValue, { placeholder: 'Select service category' })),
        React.createElement(
          SelectContent,
          {},
          ['Tax Filing & Planning', 'Bookkeeping', 'Audit'].map((t) =>
            React.createElement(SelectItem, { key: t, value: t }, t),
          ),
        ),
      )
    }

    const root = ReactDOMClient.createRoot(container)
    act(() => {
      root.render(React.createElement(Harness))
    })

    const trigger = container.querySelector('button') as HTMLButtonElement
    expect(trigger.textContent).toBe('Select service category')
    expect(container.querySelectorAll('[class*="cursor-pointer"]').length).toBe(0)

    act(() => {
      trigger.dispatchEvent(new window.Event('click', { bubbles: true }))
    })
    const items = container.querySelectorAll('[class*="cursor-pointer"]')
    expect(items.length).toBe(3)

    act(() => {
      items[0].dispatchEvent(new window.Event('click', { bubbles: true }))
    })

    expect(latestValue).toBe('Tax Filing & Planning')
    expect(trigger.textContent).toBe('Tax Filing & Planning')
    expect(container.querySelectorAll('[class*="cursor-pointer"]').length).toBe(0)

    act(() => {
      root.unmount()
    })
  })
})

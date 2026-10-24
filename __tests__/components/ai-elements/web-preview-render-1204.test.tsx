// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import {
  WebPreview,
  WebPreviewNavigation,
  WebPreviewNavigationButton,
  WebPreviewUrl,
  WebPreviewBody,
  WebPreviewConsole,
} from '@/components/ai-elements/web-preview'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — web-preview.tsx (components/ai-elements/web
 * -preview.tsx, 264 lines, reached live via components/chat/preview-panel.tsx)
 * had zero test coverage. A real context provider + several real, non-trivial
 * behaviors: the defaultUrl-sync effect, Enter-key URL commit, the real
 * src-vs-context-url precedence in WebPreviewBody, and WebPreviewConsole's
 * collapsible log rendering (not currently used by PreviewPanel, but a real
 * exported component in its own right).
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function setInputValue(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!.set!
  setter.call(input, value)
  input.dispatchEvent(new Event('input', { bubbles: true }))
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  vi.restoreAllMocks()
})

describe('WebPreview context + primitives — real url/sync/precedence coverage (#1204)', () => {
  it('throws the real "must be used within a WebPreview" error when a child primitive renders outside the provider', () => {
    const consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => {
      render(React.createElement(WebPreviewUrl))
    }).toThrow('WebPreview components must be used within a WebPreview')
    consoleErrorSpy.mockRestore()
  })

  it('WebPreviewUrl reads the real initial defaultUrl from context', () => {
    render(React.createElement(WebPreview, { defaultUrl: '/preview/abc' }, React.createElement(WebPreviewUrl)))
    const input = host.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('/preview/abc')
  })

  it('a real defaultUrl prop change after mount updates the real context url (the sync effect)', async () => {
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewUrl)))
    let input = host.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('')

    await act(async () => {
      root.render(React.createElement(WebPreview, { defaultUrl: '/preview/updated' }, React.createElement(WebPreviewUrl)))
    })

    input = host.querySelector('input') as HTMLInputElement
    expect(input.value).toBe('/preview/updated')
  })

  it('pressing real Enter in WebPreviewUrl commits the typed value to context AND calls the real onUrlChange callback', async () => {
    // Real finding: WebPreviewUrl is a FULLY controlled input
    // (value={value ?? url}) with no local state of its own — without a
    // real onChange wired up, React resets the DOM value back to the
    // `value` prop on the very next render, so a bare
    // setInputValue()-then-dispatch-Enter never actually works (confirmed:
    // an earlier draft of this test asserted onUrlChange('/preview/typed')
    // and got '' instead, because the DOM value had already snapped back).
    // Reflects this component's REAL contract: the caller (here,
    // PreviewPanel passes readOnly + a static value, never wiring onChange
    // at all) must supply both value and onChange for typing to work, same
    // as any plain controlled <input>. Tested here via a small real
    // controlled wrapper, the way an actual caller would use it.
    const onUrlChange = vi.fn()
    function ControlledWrapper() {
      const [value, setValue] = React.useState('')
      return React.createElement(WebPreview, { defaultUrl: '', onUrlChange }, [
        React.createElement(WebPreviewUrl, { key: 'url', value, onChange: (e: React.ChangeEvent<HTMLInputElement>) => setValue(e.target.value) }),
        React.createElement(WebPreviewBody, { key: 'body' }),
      ])
    }
    render(React.createElement(ControlledWrapper))

    const input = host.querySelector('input') as HTMLInputElement
    await act(async () => { setInputValue(input, '/preview/typed') })
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    })

    expect(onUrlChange).toHaveBeenCalledWith('/preview/typed')
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('src')).toBe('/preview/typed')
  })

  it('a non-Enter real keydown in WebPreviewUrl never commits the value to context', async () => {
    const onUrlChange = vi.fn()
    render(React.createElement(WebPreview, { defaultUrl: '', onUrlChange }, React.createElement(WebPreviewUrl)))

    const input = host.querySelector('input') as HTMLInputElement
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true }))
    })

    expect(onUrlChange).not.toHaveBeenCalled()
  })

  it('WebPreviewBody prefers a real explicit src prop over the real context url', () => {
    render(React.createElement(WebPreview, { defaultUrl: '/context-url' }, React.createElement(WebPreviewBody, { src: '/explicit-src' })))
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('src')).toBe('/explicit-src')
  })

  it('WebPreviewBody falls back to the real context url when no src prop is given', () => {
    render(React.createElement(WebPreview, { defaultUrl: '/context-url' }, React.createElement(WebPreviewBody)))
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.getAttribute('src')).toBe('/context-url')
  })

  it('WebPreviewBody renders a real undefined src (never an empty string) when both are genuinely empty', () => {
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewBody)))
    const iframe = host.querySelector('iframe') as HTMLIFrameElement
    expect(iframe.hasAttribute('src')).toBe(false)
  })

  it('renders the real loading node alongside the iframe when given', () => {
    // WebPreviewBodyProps intersects ComponentProps<'iframe'> (which has its
    // own native loading?: 'eager' | 'lazy') with this component's own
    // loading?: ReactNode override — a real pre-existing type ambiguity in
    // the component's own prop types that confuses createElement's overload
    // resolution here, unrelated to what this test verifies. Cast narrowly
    // rather than loosening the assertions below.
    const bodyProps = { loading: React.createElement('p', null, 'Building…') } as unknown as React.ComponentProps<typeof WebPreviewBody>
    render(React.createElement(WebPreview, { defaultUrl: '/x' }, React.createElement(WebPreviewBody, bodyProps)))
    expect(host.textContent).toContain('Building…')
  })

  it('a real WebPreviewNavigationButton click fires its onClick and respects the real disabled prop', async () => {
    const onClick = vi.fn()
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewNavigation, null,
      React.createElement(WebPreviewNavigationButton, { onClick, tooltip: 'Refresh' }, 'R'),
    )))

    const btn = host.querySelector('button') as HTMLButtonElement
    await act(async () => { btn.click() })
    expect(onClick).toHaveBeenCalled()
  })

  it('a real disabled WebPreviewNavigationButton never fires onClick', async () => {
    const onClick = vi.fn()
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewNavigation, null,
      React.createElement(WebPreviewNavigationButton, { onClick, disabled: true, tooltip: 'Refresh' }, 'R'),
    )))

    const btn = host.querySelector('button') as HTMLButtonElement
    expect(btn.disabled).toBe(true)
    await act(async () => { btn.click() })
    expect(onClick).not.toHaveBeenCalled()
  })
})

describe('WebPreviewConsole — real collapsible log rendering coverage (#1204)', () => {
  it('shows the real "No console output" state when logs are genuinely empty, once expanded (CollapsibleContent is unmounted while closed)', async () => {
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewConsole, { logs: [] })))
    expect(host.textContent).not.toContain('No console output')

    const trigger = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Console')) as HTMLButtonElement
    await act(async () => { trigger.click() })

    expect(host.textContent).toContain('No console output')
  })

  it('renders real log entries with the real per-level styling class, once expanded', async () => {
    const logs = [
      { level: 'error' as const, message: 'Boom', timestamp: new Date('2026-01-01T10:00:00Z') },
      { level: 'warn' as const, message: 'Careful', timestamp: new Date('2026-01-01T10:00:01Z') },
      { level: 'log' as const, message: 'Info', timestamp: new Date('2026-01-01T10:00:02Z') },
    ]
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewConsole, { logs })))

    const trigger = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Console')) as HTMLButtonElement
    await act(async () => { trigger.click() })

    expect(host.textContent).toContain('Boom')
    expect(host.textContent).toContain('Careful')
    expect(host.textContent).toContain('Info')
    // The innermost div (no further div children) directly wraps one log
    // line and carries its real level-specific class — querySelectorAll
    // returns outer-to-inner, so take the deepest match for "Boom" rather
    // than the first (which would be an ancestor wrapper with no class).
    const errorLine = Array.from(host.querySelectorAll('div')).reverse().find((d) => d.textContent?.includes('Boom'))
    expect(errorLine?.className).toContain('text-destructive')
  })

  it('a real Console header click toggles the real collapsible open state (collapsed by default)', async () => {
    render(React.createElement(WebPreview, { defaultUrl: '' }, React.createElement(WebPreviewConsole, { logs: [{ level: 'log' as const, message: 'hi', timestamp: new Date() }] })))

    const trigger = Array.from(host.querySelectorAll('button')).find((b) => b.textContent?.includes('Console')) as HTMLButtonElement
    expect(trigger.closest('[data-slot="collapsible"]')?.getAttribute('data-state') ?? host.querySelector('[data-state]')?.getAttribute('data-state')).not.toBe('open')

    await act(async () => { trigger.click() })

    const panel = host.querySelector('[data-state="open"]')
    expect(panel).not.toBeNull()
  })
})

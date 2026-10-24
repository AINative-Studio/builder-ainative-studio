// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { ResizableLayout } from '@/components/shared/resizable-layout'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — ResizableLayout (components/shared/resizable
 * -layout.tsx, 116 lines, reached live via components/chats/chat-detail
 * -client.tsx) had zero test coverage.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

function baseProps(overrides: Record<string, any> = {}) {
  return {
    leftPanel: React.createElement('div', { 'data-testid': 'left-panel' }, 'Left'),
    rightPanel: React.createElement('div', { 'data-testid': 'right-panel' }, 'Right'),
    ...overrides,
  }
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
  document.body.style.cursor = ''
  document.body.style.userSelect = ''
})

describe('ResizableLayout — real drag-resize/panel-mode coverage (#1204)', () => {
  it('renders both real panels in the desktop split layout by default', () => {
    render(React.createElement(ResizableLayout, baseProps()))
    expect(host.textContent).toContain('Left')
    expect(host.textContent).toContain('Right')
  })

  it('shows only the real active panel\'s content in singlePanelMode (left by default)', () => {
    render(React.createElement(ResizableLayout, baseProps({ singlePanelMode: true })))
    expect(host.querySelector('[data-testid="left-panel"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="right-panel"]')).toBeNull()
  })

  it('shows the real rightPanel in singlePanelMode when activePanel is genuinely "right"', () => {
    render(React.createElement(ResizableLayout, baseProps({ singlePanelMode: true, activePanel: 'right' })))
    expect(host.querySelector('[data-testid="right-panel"]')).not.toBeNull()
    expect(host.querySelector('[data-testid="left-panel"]')).toBeNull()
  })

  it('renders the real desktop split with the real default 30% left width', () => {
    render(React.createElement(ResizableLayout, baseProps()))
    const desktopLeft = host.querySelector('.hidden.md\\:flex > div') as HTMLElement
    expect(desktopLeft.style.width).toBe('30%')
  })

  it('a real mousedown on the real divider starts dragging and sets the real body cursor/userSelect styles', async () => {
    render(React.createElement(ResizableLayout, baseProps()))
    const divider = host.querySelector('.cursor-col-resize') as HTMLElement

    await act(async () => {
      divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })

    expect(document.body.style.cursor).toBe('col-resize')
    expect(document.body.style.userSelect).toBe('none')
  })

  it('a real mousemove while dragging updates the real left-panel width, clamped to the real min/max bounds', async () => {
    render(React.createElement(ResizableLayout, baseProps({ minLeftWidth: 20, maxLeftWidth: 60 })))
    const container = host.querySelector('.flex.h-full') as HTMLElement
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue({ left: 0, width: 1000, top: 0, right: 1000, bottom: 0, height: 0, x: 0, y: 0, toJSON: () => ({}) } as DOMRect)

    const divider = host.querySelector('.cursor-col-resize') as HTMLElement
    await act(async () => { divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })

    // 450/1000 = 45% — within [20, 60], so used as-is.
    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 450 })) })
    const desktopLeft = host.querySelector('.hidden.md\\:flex > div') as HTMLElement
    expect(desktopLeft.style.width).toBe('45%')

    // 50/1000 = 5% — clamped up to the real 20% minimum.
    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 50 })) })
    expect(desktopLeft.style.width).toBe('20%')

    // 900/1000 = 90% — clamped down to the real 60% maximum.
    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 })) })
    expect(desktopLeft.style.width).toBe('60%')
  })

  it('a real mouseup stops dragging and restores the real body cursor/userSelect styles', async () => {
    render(React.createElement(ResizableLayout, baseProps()))
    const divider = host.querySelector('.cursor-col-resize') as HTMLElement

    await act(async () => { divider.dispatchEvent(new MouseEvent('mousedown', { bubbles: true })) })
    expect(document.body.style.cursor).toBe('col-resize')

    await act(async () => { document.dispatchEvent(new MouseEvent('mouseup')) })
    expect(document.body.style.cursor).toBe('')
    expect(document.body.style.userSelect).toBe('')
  })

  it('a real mousemove while genuinely NOT dragging never changes the left width', async () => {
    render(React.createElement(ResizableLayout, baseProps()))
    const desktopLeftBefore = (host.querySelector('.hidden.md\\:flex > div') as HTMLElement).style.width

    await act(async () => { document.dispatchEvent(new MouseEvent('mousemove', { clientX: 900 })) })

    const desktopLeftAfter = (host.querySelector('.hidden.md\\:flex > div') as HTMLElement).style.width
    expect(desktopLeftAfter).toBe(desktopLeftBefore)
  })

  it('respects the real custom defaultLeftWidth prop', () => {
    render(React.createElement(ResizableLayout, baseProps({ defaultLeftWidth: 45 })))
    const desktopLeft = host.querySelector('.hidden.md\\:flex > div') as HTMLElement
    expect(desktopLeft.style.width).toBe('45%')
  })
})

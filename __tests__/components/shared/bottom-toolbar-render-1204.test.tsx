// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { BottomToolbar } from '@/components/shared/bottom-toolbar'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — BottomToolbar (components/shared/bottom-toolbar.tsx,
 * 54 lines, reached live via components/home/home-client.tsx and
 * components/chats/chat-detail-client.tsx) had zero test coverage.
 */

let host: HTMLElement
let root: Root

function render(node: React.ReactElement) {
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
  act(() => { root.render(node) })
}

afterEach(() => {
  act(() => { root?.unmount() })
  host?.remove()
})

function buttons() {
  return Array.from(host.querySelectorAll('button'))
}

describe('BottomToolbar — real panel-switch/disabled-gating coverage (#1204)', () => {
  it('clicking Chat calls the real onPanelChange with "chat"', async () => {
    const onPanelChange = vi.fn()
    render(React.createElement(BottomToolbar, { activePanel: 'preview', onPanelChange, hasPreview: true }))

    const chatBtn = buttons().find((b) => b.textContent === 'Chat') as HTMLButtonElement
    await act(async () => { chatBtn.click() })

    expect(onPanelChange).toHaveBeenCalledWith('chat')
  })

  it('clicking Preview calls the real onPanelChange with "preview" when hasPreview is genuinely true', async () => {
    const onPanelChange = vi.fn()
    render(React.createElement(BottomToolbar, { activePanel: 'chat', onPanelChange, hasPreview: true }))

    const previewBtn = buttons().find((b) => b.textContent === 'Preview') as HTMLButtonElement
    await act(async () => { previewBtn.click() })

    expect(onPanelChange).toHaveBeenCalledWith('preview')
  })

  it('disables the real Preview button when hasPreview is genuinely false', () => {
    render(React.createElement(BottomToolbar, { activePanel: 'chat', onPanelChange: vi.fn(), hasPreview: false }))

    const previewBtn = buttons().find((b) => b.textContent === 'Preview') as HTMLButtonElement
    expect(previewBtn.disabled).toBe(true)
  })

  it('never calls onPanelChange when clicking a genuinely disabled Preview button', async () => {
    const onPanelChange = vi.fn()
    render(React.createElement(BottomToolbar, { activePanel: 'chat', onPanelChange, hasPreview: false }))

    const previewBtn = buttons().find((b) => b.textContent === 'Preview') as HTMLButtonElement
    await act(async () => { previewBtn.click() })

    expect(onPanelChange).not.toHaveBeenCalled()
  })

  it('applies the real active styling to Chat when activePanel is genuinely "chat"', () => {
    render(React.createElement(BottomToolbar, { activePanel: 'chat', onPanelChange: vi.fn(), hasPreview: true }))

    const chatBtn = buttons().find((b) => b.textContent === 'Chat') as HTMLButtonElement
    const previewBtn = buttons().find((b) => b.textContent === 'Preview') as HTMLButtonElement
    expect(chatBtn.className).toContain('bg-background')
    expect(previewBtn.className).not.toContain('bg-background')
  })

  it('applies the real active styling to Preview when activePanel is genuinely "preview"', () => {
    render(React.createElement(BottomToolbar, { activePanel: 'preview', onPanelChange: vi.fn(), hasPreview: true }))

    const chatBtn = buttons().find((b) => b.textContent === 'Chat') as HTMLButtonElement
    const previewBtn = buttons().find((b) => b.textContent === 'Preview') as HTMLButtonElement
    expect(previewBtn.className).toContain('bg-background')
    expect(chatBtn.className).not.toContain('bg-background')
  })
})

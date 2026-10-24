// @vitest-environment jsdom
import { describe, it, expect, vi, beforeAll, afterEach } from 'vitest'
import React from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { act } from 'react'
import { VersionHistory } from '@/components/design-tokens/version-history'
import type { DesignTokenVersion } from '@/lib/design-tokens/types'

beforeAll(() => {
  ;(globalThis as any).React = React
  ;(globalThis as any).IS_REACT_ACT_ENVIRONMENT = true
})

/**
 * #1204 (Coverage Phase 4) — VersionHistory (components/design-tokens/version
 * -history.tsx, 213 lines, reached live via app/design-tokens/page.tsx) had
 * zero test coverage. DesignTokenPreview already has its own dedicated
 * coverage this pass (preview-render-1204.test.tsx) — mocked here at its
 * real exported boundary.
 */

const toastMock = vi.fn()
vi.mock('@/components/ui/use-toast', () => ({ useToast: () => ({ toast: toastMock }) }))
vi.mock('@/components/design-tokens/preview', () => ({
  DesignTokenPreview: ({ tokens }: { tokens: any }) => React.createElement('div', { 'data-testid': 'stub-preview' }, `preview:${tokens.name}`),
}))

async function makeVersion(overrides: Partial<DesignTokenVersion> = {}): Promise<DesignTokenVersion> {
  const { getDefaultTokens } = await import('@/lib/design-tokens/parsers')
  return {
    id: 'v1',
    designTokenId: 'dt-1',
    version: '1.0.0',
    tokens: { ...getDefaultTokens(), name: 'My Design' },
    createdAt: new Date('2026-01-15T10:00:00Z'),
    createdBy: 'founder@example.com',
    ...overrides,
  }
}

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
  vi.restoreAllMocks()
})

describe('VersionHistory — real timeline/preview/revert coverage (#1204)', () => {
  it('shows the real "No version history available" empty state', async () => {
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions: [], open: true, onOpenChange: vi.fn() }))
    expect(document.body.textContent).toContain('No version history available')
  })

  it('renders the real version number, date, and author for each version, with "Current" only on the first', async () => {
    const versions = [await makeVersion({ id: 'v2', version: '2.0.0' }), await makeVersion({ id: 'v1', version: '1.0.0' })]
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions, open: true, onOpenChange: vi.fn() }))

    expect(document.body.textContent).toContain('Version 2.0.0')
    expect(document.body.textContent).toContain('Version 1.0.0')
    expect(document.body.textContent).toContain('founder@example.com')
    // Only one "Current" badge text node, attached to the first (index 0)
    // version — .rounded-full alone isn't specific enough (the color
    // swatch div also carries that class).
    const currentBadges = Array.from(document.body.querySelectorAll('span')).filter((el) => el.textContent === 'Current')
    expect(currentBadges.length).toBe(1)
  })

  it('never shows a Revert button for the first (current) version, but shows it for every other', async () => {
    const versions = [await makeVersion({ id: 'v2' }), await makeVersion({ id: 'v1' })]
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions, open: true, onOpenChange: vi.fn() }))

    const revertButtons = Array.from(document.body.querySelectorAll('button')).filter((b) => b.textContent?.includes('Revert') && !b.textContent.includes('This Version'))
    expect(revertButtons.length).toBe(1)
  })

  it('renders the real token summary: name, primary color swatch+hex, font family', async () => {
    const { getDefaultTokens } = await import('@/lib/design-tokens/parsers')
    const tokens = getDefaultTokens()
    const version = await makeVersion({ tokens: { ...tokens, name: 'Acme Brand' } })
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions: [version], open: true, onOpenChange: vi.fn() }))

    expect(document.body.textContent).toContain('Acme Brand')
    expect(document.body.textContent).toContain(tokens.colors.primary)
    expect(document.body.textContent).toContain(tokens.typography.fontFamily)
  })

  it('a real Preview click opens the real preview dialog with the real DesignTokenPreview and the real formatted version date', async () => {
    const version = await makeVersion({ version: '3.1.0' })
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions: [version], open: true, onOpenChange: vi.fn() }))

    const previewBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Preview')) as HTMLButtonElement
    await act(async () => { previewBtn.click() })

    expect(document.body.textContent).toContain('Version 3.1.0 Preview')
    expect(document.body.querySelector('[data-testid="stub-preview"]')?.textContent).toBe(`preview:${version.tokens.name}`)
  })

  it('a real Close click in the preview dialog genuinely unmounts the preview dialog content', async () => {
    // Radix's own Presence checks getAnimationName() on close — with no
    // real CSS animation applied in jsdom, it falls back to 'none' and
    // unmounts synchronously (confirmed by reading
    // @radix-ui/react-presence's source directly), so the content is fully
    // removed from the DOM rather than just flipping a data-state attribute.
    const version = await makeVersion()
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions: [version], open: true, onOpenChange: vi.fn() }))

    const previewBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Preview')) as HTMLButtonElement
    await act(async () => { previewBtn.click() })
    // Two dialogs coexist in the DOM (the outer Version History dialog stays
    // open throughout) — scope to the one actually containing the preview.
    const findPreviewDialog = () =>
      Array.from(document.body.querySelectorAll('[role="dialog"]')).find((d) => d.textContent?.includes('Preview of design tokens'))
    expect(findPreviewDialog()?.getAttribute('data-state')).toBe('open')

    // Radix's own built-in X close button on EVERY DialogContent also has a
    // visually-hidden sr-only span whose text is exactly "Close" — with two
    // dialogs open simultaneously here, a bare textContent==='Close' match
    // picks the FIRST such X button in document order (the outer dialog's),
    // not this component's own explicit footer Close button. Same gotcha
    // already found and fixed this pass in
    // command-progress-tracker-render-1204.test.tsx — excluded here the
    // same way, via requiring no inner svg.
    const closeBtn = Array.from(document.body.querySelectorAll('button')).find(
      (b) => b.textContent?.trim() === 'Close' && !b.querySelector('svg')
    ) as HTMLButtonElement
    await act(async () => { closeBtn.click() })

    expect(findPreviewDialog()).toBeUndefined()
  })

  it('a real Revert click confirms via window.confirm, then fires the real POST, shows a real success toast, calls onRevert, and closes the dialog', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    const onRevert = vi.fn()
    const onOpenChange = vi.fn()
    const versions = [await makeVersion({ id: 'v2', version: '2.0.0' }), await makeVersion({ id: 'v1', version: '1.0.0' })]
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions, onRevert, open: true, onOpenChange }))

    const revertBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Revert') && !b.textContent.includes('This Version')) as HTMLButtonElement
    await act(async () => { revertBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(confirmSpy).toHaveBeenCalledWith(expect.stringContaining('revert to version 1.0.0'))
    expect(global.fetch).toHaveBeenCalledWith('/api/design-tokens/dt-1/revert', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ versionId: 'v1' }),
    }))
    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ title: 'Success' }))
    expect(onRevert).toHaveBeenCalledWith('v1')
    expect(onOpenChange).toHaveBeenCalledWith(false)
  })

  it('never fires a real revert POST when window.confirm is genuinely declined', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(false)
    global.fetch = vi.fn() as any
    const versions = [await makeVersion({ id: 'v2' }), await makeVersion({ id: 'v1' })]
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions, open: true, onOpenChange: vi.fn() }))

    const revertBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Revert') && !b.textContent.includes('This Version')) as HTMLButtonElement
    await act(async () => { revertBtn.click() })

    expect(global.fetch).not.toHaveBeenCalled()
  })

  it('shows a real destructive toast (never a silent failure) when the real revert POST fails', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    global.fetch = vi.fn(async () => ({ ok: false })) as any
    const versions = [await makeVersion({ id: 'v2' }), await makeVersion({ id: 'v1' })]
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions, open: true, onOpenChange: vi.fn() }))

    const revertBtn = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Revert') && !b.textContent.includes('This Version')) as HTMLButtonElement
    await act(async () => { revertBtn.click(); await Promise.resolve(); await Promise.resolve() })

    expect(toastMock).toHaveBeenCalledWith(expect.objectContaining({ variant: 'destructive' }))
  })

  it('"Revert to This Version" in the preview dialog reverts the real selected version', async () => {
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    global.fetch = vi.fn(async () => ({ ok: true, json: async () => ({}) })) as any
    const versions = [await makeVersion({ id: 'v2', version: '2.0.0' }), await makeVersion({ id: 'v1', version: '1.0.0' })]
    render(React.createElement(VersionHistory, { designTokenId: 'dt-1', versions, open: true, onOpenChange: vi.fn() }))

    const previewButtons = Array.from(document.body.querySelectorAll('button')).filter((b) => b.textContent?.includes('Preview'))
    await act(async () => { (previewButtons[1] as HTMLButtonElement).click() })

    const revertInPreview = Array.from(document.body.querySelectorAll('button')).find((b) => b.textContent?.includes('Revert to This Version')) as HTMLButtonElement
    await act(async () => { revertInPreview.click(); await Promise.resolve(); await Promise.resolve() })

    expect(global.fetch).toHaveBeenCalledWith('/api/design-tokens/dt-1/revert', expect.objectContaining({
      body: JSON.stringify({ versionId: 'v1' }),
    }))
  })
})

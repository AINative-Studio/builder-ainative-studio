// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
})

/**
 * #1302: this page used to call the plain `resolveApp()`, whose ambiguous
 * `null` return collapses "no such company" and "the registry lookup itself
 * failed" into the same thing — the exact anti-pattern #832 already fixed
 * for the resolve-app API route and build-context.tsx's deep-link check, but
 * never applied to this page even though it's the real public rendering
 * surface behind a company's shareable `/build/{slug}` link. A transient
 * registry hiccup must not make a real, live company look "still being
 * built" to a visitor.
 */

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: vi.fn() }))

vi.mock('@/components/build/StandalonePreviewRegenerate', () => ({
  StandalonePreviewRegenerate: () => null,
}))
vi.mock('@/components/build/StandalonePreviewFrame', () => ({
  StandalonePreviewFrame: () => null,
}))

import AppSubdirPage from '@/app/build/[slug]/page'
import { resolveAppVerified as resolveAppVerifiedImport } from '@/lib/build/app-registry'
const resolveAppVerified = vi.mocked(resolveAppVerifiedImport)

function renderToText(node: React.ReactNode): string {
  const parts: string[] = []
  const visit = (n: React.ReactNode) => {
    if (n == null || typeof n === 'boolean') return
    if (typeof n === 'string' || typeof n === 'number') {
      parts.push(String(n))
      return
    }
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (React.isValidElement(n)) {
      visit((n.props as { children?: React.ReactNode })?.children)
    }
  }
  visit(node)
  return parts.join(' ')
}

describe('/build/[slug] page — verified vs. unverified registry miss (#1302)', () => {
  it('shows the honest "could not load" message when the registry lookup itself failed (verified: false)', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: false })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme' }) })
    const text = renderToText(tree)
    expect(text).toContain("couldn't load this preview")
    expect(text).not.toContain('still being built')
  })

  it('shows the real "still being built" message only on a confirmed miss (verified: true, no entry)', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: true })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme' }) })
    const text = renderToText(tree)
    expect(text).toContain('still being built')
    expect(text).not.toContain("couldn't load this preview")
  })

  it('renders the real preview when a chatId is found regardless of the verified flag', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { chatId: 'chat-1', name: 'Acme', color: '#2f6d86', idea: 'an idea', track: 'company', slug: 'acme', createdAt: new Date().toISOString() },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme' }) })
    const text = renderToText(tree)
    expect(text).not.toContain('still being built')
    expect(text).not.toContain("couldn't load this preview")
  })
})

/**
 * #1956 — real bug found live (company "younova", chatId yWuTbfQZXCWH_-HEYhHDK):
 * this page checked only entry.chatId, never entry.lifecycleStatus, so a
 * company the founder took offline via Danger Zone (lifecycleStatus
 * 'offline' — see danger-zone.ts's own doc comment) still fell through to
 * render StandalonePreviewFrame, which iframes /api/preview/{chatId}. With no
 * generation content behind an offline app, that endpoint's own internal
 * retry loop never resolves — confirmed live via direct browser reproduction:
 * a permanent "Preparing your preview…" spinner, 15+ consecutive polls over
 * 2+ minutes with zero console errors, never reaching either a real preview
 * or the route's own terminal "Preview Unavailable" page. A visitor hitting
 * the public URL of an intentionally offline (or soft-deleted) company
 * deserves an honest, immediate message instead of an indefinite unexplained
 * loading state.
 */
describe('/build/[slug] page — an offline or deleted company shows a clear message instead of an indefinite preview spinner (#1956)', () => {
  const baseEntry = {
    chatId: 'chat-1',
    name: 'Younova',
    color: '#2f6d86',
    idea: 'an idea',
    track: 'app' as const,
    slug: 'younova',
    createdAt: new Date().toISOString(),
  }

  it('shows "this app is currently offline" instead of rendering the preview when lifecycleStatus is offline', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { ...baseEntry, lifecycleStatus: 'offline' as const },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'younova' }) })
    const text = renderToText(tree)
    expect(text).toContain('currently offline')
    expect(text).not.toContain('still being built')
  })

  it('gives the same offline treatment to a soft-deleted company (resolveAppVerified still returns its chatId)', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { ...baseEntry, lifecycleStatus: 'deleted' as const },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'younova' }) })
    const text = renderToText(tree)
    expect(text).toContain('currently offline')
  })

  it('still renders the real preview for an active company (lifecycleStatus "active")', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { ...baseEntry, lifecycleStatus: 'active' as const },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'younova' }) })
    const text = renderToText(tree)
    expect(text).not.toContain('currently offline')
    expect(text).not.toContain('still being built')
  })

  it('still renders the real preview when lifecycleStatus is entirely absent (legacy rows, defaults to active)', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { ...baseEntry },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'younova' }) })
    const text = renderToText(tree)
    expect(text).not.toContain('currently offline')
    expect(text).not.toContain('still being built')
  })
})

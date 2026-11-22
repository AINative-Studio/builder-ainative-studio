// @vitest-environment node
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'
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

vi.mock('@/lib/build/app-registry', () => ({ resolveAppVerified: vi.fn(), resolveShowcaseOnlyBySlug: vi.fn() }))

vi.mock('@/components/build/StandalonePreviewRegenerate', () => ({
  StandalonePreviewRegenerate: () => null,
}))
vi.mock('@/components/build/StandalonePreviewFrame', () => ({
  StandalonePreviewFrame: () => null,
}))

import AppSubdirPage from '@/app/build/[slug]/page'
import { resolveAppVerified as resolveAppVerifiedImport, resolveShowcaseOnlyBySlug as resolveShowcaseOnlyBySlugImport } from '@/lib/build/app-registry'
const resolveAppVerified = vi.mocked(resolveAppVerifiedImport)
const resolveShowcaseOnlyBySlug = vi.mocked(resolveShowcaseOnlyBySlugImport)

beforeEach(() => {
  resolveShowcaseOnlyBySlug.mockReset()
  resolveShowcaseOnlyBySlug.mockResolvedValue(null)
})

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

/** #2209 — finds real host elements of a given tag (e.g. 'h1') anywhere in
 *  the tree, returning their rendered text. Distinct from renderToText,
 *  which only collects strings and can't tell whether a given piece of text
 *  is inside a real <h1> vs any other element. */
function findElementsByType(node: React.ReactNode, type: string): string[] {
  const found: string[] = []
  const visit = (n: React.ReactNode) => {
    if (n == null || typeof n === 'boolean') return
    if (typeof n === 'string' || typeof n === 'number') return
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (React.isValidElement(n)) {
      const children = (n.props as { children?: React.ReactNode })?.children
      if (n.type === type) found.push(renderToText(children))
      visit(children)
    }
  }
  visit(node)
  return found
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
 * #2126 follow-up: a confirmed registry miss used to always render "still
 * being built", even for a real, complete, never-registered showcase
 * generation (confirmed live for 8/8 freshly sampled unregistered showcase
 * entries — see #2126's comment thread). `resolveShowcaseOnlyBySlug` gives
 * this page a second, narrower chance to resolve exactly what `/showcase`
 * already publicly lists before giving up.
 */
describe('/build/[slug] page — showcase-only fallback for a never-registered generation (#2126 follow-up)', () => {
  it('renders the real preview via the showcase-only fallback on a confirmed registry miss', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: true })
    resolveShowcaseOnlyBySlug.mockResolvedValueOnce({ chatId: 'chat-showcase-1', name: 'Quill', idea: 'an idea' })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'quill-pHi9Mh' }) })
    const text = renderToText(tree)
    expect(text).not.toContain('still being built')
    expect(text).not.toContain("couldn't load this preview")
  })

  it('still shows "still being built" when the showcase-only fallback also finds nothing', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: true })
    resolveShowcaseOnlyBySlug.mockResolvedValueOnce(null)
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'never-existed' }) })
    const text = renderToText(tree)
    expect(text).toContain('still being built')
  })

  it('never tries the showcase-only fallback on a transient registry failure (verified: false)', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: null, verified: false })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme' }) })
    const text = renderToText(tree)
    expect(text).toContain("couldn't load this preview")
    expect(resolveShowcaseOnlyBySlug).not.toHaveBeenCalled()
  })

  it('never consults the showcase-only fallback when the registry already has a real chatId', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { chatId: 'chat-1', name: 'Acme', color: '#2f6d86', idea: 'an idea', track: 'company', slug: 'acme', createdAt: new Date().toISOString() },
      verified: true,
    })
    await AppSubdirPage({ params: Promise.resolve({ slug: 'acme' }) })
    expect(resolveShowcaseOnlyBySlug).not.toHaveBeenCalled()
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

/**
 * #2208 — AX "Claimable Resources" gap on generated sites: the real checker
 * (core's check_claimable_resources) scans the company's own /build/{slug}
 * page body for a fixed literal phrase list. Only true for a genuinely
 * unclaimed company (no ownerEmail) — stating it on an already-owned
 * company's page would be factually wrong.
 */
describe('/build/[slug] page — claimable-resource language (#2208)', () => {
  const baseEntry = {
    chatId: 'chat-1',
    name: 'Wrench',
    color: '#2f6d86',
    idea: 'an idea',
    track: 'company' as const,
    slug: 'wrench',
    createdAt: new Date().toISOString(),
  }

  it('states claimable-resource language, including the exact checker phrase, for an unclaimed (no ownerEmail) company', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: { ...baseEntry }, verified: true })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'wrench' }) })
    const text = renderToText(tree).toLowerCase()
    expect(text).toContain('claim this project')
  })

  it('does NOT state claimable-resource language for an already-claimed (has ownerEmail) company', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { ...baseEntry, ownerEmail: 'founder@example.com' },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'wrench' }) })
    const text = renderToText(tree).toLowerCase()
    expect(text).not.toContain('claim this project')
  })
})

/**
 * #2209 — AX "SSR Detection" gap on generated sites: real checker source
 * (core's check_ssr_detection) gates a full pass on `has_h1 = "<h1" in
 * body_lower` — a plain literal substring check. The real company name/idea
 * never appeared as actual SSR'd text before this fix (only inside <meta>/
 * <title> tags or a client-hydration-only React Flight payload).
 */
describe('/build/[slug] page — real server-rendered <h1> with the company name (#2209)', () => {
  const baseEntry = {
    chatId: 'chat-1',
    name: 'Wrench',
    color: '#2f6d86',
    idea: 'an idea',
    track: 'company' as const,
    slug: 'wrench',
    createdAt: new Date().toISOString(),
  }

  it('renders a real <h1> element containing the company name', async () => {
    resolveAppVerified.mockResolvedValueOnce({ entry: { ...baseEntry }, verified: true })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'wrench' }) })
    const h1s = findElementsByType(tree, 'h1')
    expect(h1s).toContain('Wrench')
  })

  it('falls back to the slug for the <h1> when the company has no name', async () => {
    resolveAppVerified.mockResolvedValueOnce({
      entry: { ...baseEntry, name: undefined },
      verified: true,
    })
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'wrench' }) })
    const h1s = findElementsByType(tree, 'h1')
    expect(h1s).toContain('wrench')
  })
})

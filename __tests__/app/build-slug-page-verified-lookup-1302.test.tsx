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

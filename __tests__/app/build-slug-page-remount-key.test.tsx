// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
})

/**
 * #1126 follow-up: Next.js App Router reconciles this page's component tree
 * across a client-side /build/{slugA} -> /build/{slugB} navigation rather
 * than unmounting it, because only the `slug` prop changes, not the React
 * tree's shape or any key. Without an explicit `key`, the StandalonePreviewFrame
 * (and the SandpackProvider/bundler iframe nested inside it) survives a
 * company switch — carrying the previous company's sandpack-bundler barrel
 * cache into the new company's compile, the confirmed live trigger for
 * #1126's cross-company "Element type is invalid" crash.
 *
 * `key={slug}` is invisible to a DOM-level render (React strips `key` out of
 * `props` entirely), so this asserts it the only way it can be observed:
 * directly on the React element object returned by the page.
 */

vi.mock('@/lib/build/app-registry', () => ({
  resolveApp: vi.fn(async (slug: string) => ({
    chatId: `chat-${slug}`,
    name: `Company ${slug}`,
    color: '#2f6d86',
    idea: 'a test idea',
    track: 'company',
  })),
}))

vi.mock('@/components/build/StandalonePreviewRegenerate', () => ({
  StandalonePreviewRegenerate: () => null,
}))

vi.mock('@/components/build/StandalonePreviewFrame', () => ({
  StandalonePreviewFrame: () => null,
}))

import AppSubdirPage from '@/app/build/[slug]/page'
import { StandalonePreviewFrame } from '@/components/build/StandalonePreviewFrame'

function findElementsByType(node: React.ReactNode, type: unknown): React.ReactElement[] {
  const found: React.ReactElement[] = []
  const visit = (n: React.ReactNode) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (React.isValidElement(n)) {
      if (n.type === type) found.push(n)
      visit((n.props as { children?: React.ReactNode })?.children)
    }
  }
  visit(node)
  return found
}

describe('/build/[slug] page — StandalonePreviewFrame keyed by slug (#1126 follow-up)', () => {
  it('keys StandalonePreviewFrame by slug, so a company switch forces a real remount', async () => {
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme-widgets' }) })
    const matches = findElementsByType(tree, StandalonePreviewFrame)
    expect(matches).toHaveLength(1)
    expect(matches[0].key).toBe('acme-widgets')
  })

  it('gives two different companies two different keys', async () => {
    const treeA = await AppSubdirPage({ params: Promise.resolve({ slug: 'alpha' }) })
    const treeB = await AppSubdirPage({ params: Promise.resolve({ slug: 'beta' }) })
    const keyA = findElementsByType(treeA, StandalonePreviewFrame)[0].key
    const keyB = findElementsByType(treeB, StandalonePreviewFrame)[0].key
    expect(keyA).toBe('alpha')
    expect(keyB).toBe('beta')
    expect(keyA).not.toBe(keyB)
  })
})

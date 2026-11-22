// @vitest-environment node
import { describe, it, expect, vi, beforeAll } from 'vitest'
import React from 'react'

beforeAll(() => {
  ;(globalThis as any).React = React
})

/**
 * #2210: the real `ainative-ax` audit scores "Structured Data" 0/1 on
 * /build/{slug} because the SSR HTML has zero `application/ld+json` blocks —
 * OpenGraph tags alone give no credit. This asserts the page actually emits
 * one, parseable, with the real per-company data (not hardcoded Builder-brand
 * copy).
 */

vi.mock('@/lib/build/app-registry', () => ({
  resolveAppVerified: vi.fn(async (slug: string) => ({
    entry: {
      chatId: `chat-${slug}`,
      name: `Company ${slug}`,
      color: '#2f6d86',
      tagline: `${slug}'s real tagline`,
      idea: 'a test idea',
      track: 'company',
    },
    verified: true,
  })),
}))

vi.mock('@/components/build/StandalonePreviewRegenerate', () => ({
  StandalonePreviewRegenerate: () => null,
}))

vi.mock('@/components/build/StandalonePreviewFrame', () => ({
  StandalonePreviewFrame: () => null,
}))

import AppSubdirPage from '@/app/build/[slug]/page'

function findScriptJsonLd(node: React.ReactNode): unknown[] {
  const found: unknown[] = []
  const visit = (n: React.ReactNode) => {
    if (!n || typeof n !== 'object') return
    if (Array.isArray(n)) {
      n.forEach(visit)
      return
    }
    if (React.isValidElement(n)) {
      const props = n.props as { type?: string; dangerouslySetInnerHTML?: { __html: string }; children?: React.ReactNode }
      if (n.type === 'script' && props.type === 'application/ld+json' && props.dangerouslySetInnerHTML) {
        found.push(JSON.parse(props.dangerouslySetInnerHTML.__html))
      }
      visit(props.children)
    }
  }
  visit(node)
  return found
}

describe('/build/[slug] page — JSON-LD structured data (#2210)', () => {
  it('emits a parseable application/ld+json block with the real company name, description and canonical url', async () => {
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme-widgets' }) })
    const blocks = findScriptJsonLd(tree)
    expect(blocks).toHaveLength(1)
    const jsonLd = blocks[0] as Record<string, unknown>
    expect(jsonLd['@context']).toBe('https://schema.org')
    expect(jsonLd.name).toBe('Company acme-widgets')
    expect(jsonLd.description).toBe("acme-widgets's real tagline")
    expect(jsonLd.url).toBe('https://builder.ainative.studio/build/acme-widgets')
  })

  it('never fabricates a rating, price, or other field with no real data behind it', async () => {
    const tree = await AppSubdirPage({ params: Promise.resolve({ slug: 'acme-widgets' }) })
    const jsonLd = findScriptJsonLd(tree)[0] as Record<string, unknown>
    expect(jsonLd.aggregateRating).toBeUndefined()
    expect(jsonLd.offers).toBeUndefined()
  })
})

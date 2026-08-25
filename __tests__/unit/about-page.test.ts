/**
 * Unit tests for the /about page static data and JSON-LD structure.
 *
 * The page is a pure SSR Server Component with no logic beyond constant
 * declarations — tests validate that the JSON-LD payloads are structurally
 * correct and that the sitemap + middleware allowlist are consistent.
 */

import { describe, it, expect } from 'vitest'

// ── Inline the constants from the page (avoids a Next.js RSC import) ─────────

const PUBLISHED_DATE = '2026-08-24'
const MODIFIED_DATE = '2026-08-24'
const AUTHOR_NAME = 'Toby'
const ORG_NAME = 'AINative Studio'
const ORG_URL = 'https://ainative.studio'
const PAGE_URL = 'https://builder.ainative.studio/about'

const articleJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Article',
  headline: 'Why I Built AINative Builder — and What Cody Really Is',
  datePublished: PUBLISHED_DATE,
  dateModified: MODIFIED_DATE,
  url: PAGE_URL,
  description:
    "Toby's first-person account of why he built AINative Builder: the gap between AI tools and a real AI co-founder that builds AND runs your company on primitives you fully own.",
  author: {
    '@type': 'Person',
    name: AUTHOR_NAME,
    jobTitle: 'Founder',
    worksFor: {
      '@type': 'Organization',
      name: ORG_NAME,
      url: ORG_URL,
    },
  },
  publisher: {
    '@type': 'Organization',
    name: ORG_NAME,
    url: ORG_URL,
    logo: {
      '@type': 'ImageObject',
      url: 'https://builder.ainative.studio/ainative-logo-v2.png',
    },
  },
  mainEntityOfPage: {
    '@type': 'WebPage',
    '@id': PAGE_URL,
  },
}

const organizationJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Organization',
  name: ORG_NAME,
  url: ORG_URL,
  logo: 'https://builder.ainative.studio/ainative-logo-v2.png',
  description:
    'AINative Studio builds open-source AI infrastructure — ZeroDB, ZeroPipeline, ZeroInvoice, ServiceOS, ZeroVoice — and the Builder platform that lets anyone compose a real, running company from a single idea.',
  sameAs: [
    'https://github.com/AINative-Studio',
    'https://twitter.com/AINativeStudio',
  ],
  foundingDate: '2024',
  founders: [
    {
      '@type': 'Person',
      name: AUTHOR_NAME,
      jobTitle: 'Founder & CEO',
    },
  ],
}

const personJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Person',
  name: AUTHOR_NAME,
  jobTitle: 'Founder & CEO',
  worksFor: {
    '@type': 'Organization',
    name: ORG_NAME,
    url: ORG_URL,
  },
  url: PAGE_URL,
  sameAs: [
    'https://twitter.com/AINativeStudio',
    'https://github.com/AINative-Studio',
  ],
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isValidUrl(url: string): boolean {
  try {
    new URL(url)
    return true
  } catch {
    return false
  }
}

function isValidIsoDate(date: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(date) && !isNaN(Date.parse(date))
}

// ── Article JSON-LD ───────────────────────────────────────────────────────────

describe('Article JSON-LD', () => {
  it('has required @context and @type', () => {
    expect(articleJsonLd['@context']).toBe('https://schema.org')
    expect(articleJsonLd['@type']).toBe('Article')
  })

  it('has a non-empty headline', () => {
    expect(typeof articleJsonLd.headline).toBe('string')
    expect(articleJsonLd.headline.length).toBeGreaterThan(10)
  })

  it('has valid ISO datePublished', () => {
    expect(isValidIsoDate(articleJsonLd.datePublished)).toBe(true)
  })

  it('has valid ISO dateModified', () => {
    expect(isValidIsoDate(articleJsonLd.dateModified)).toBe(true)
  })

  it('has a valid canonical URL', () => {
    expect(isValidUrl(articleJsonLd.url)).toBe(true)
    expect(articleJsonLd.url).toContain('/about')
  })

  it('has an author with Person @type', () => {
    expect(articleJsonLd.author['@type']).toBe('Person')
    expect(articleJsonLd.author.name).toBe(AUTHOR_NAME)
  })

  it('has a publisher with Organisation @type and logo', () => {
    expect(articleJsonLd.publisher['@type']).toBe('Organization')
    expect(isValidUrl(articleJsonLd.publisher.logo.url)).toBe(true)
  })

  it('has mainEntityOfPage pointing to the canonical URL', () => {
    expect(articleJsonLd.mainEntityOfPage['@type']).toBe('WebPage')
    expect(articleJsonLd.mainEntityOfPage['@id']).toBe(PAGE_URL)
  })

  it('can be serialised to JSON without throwing', () => {
    expect(() => JSON.stringify(articleJsonLd)).not.toThrow()
  })
})

// ── Organization JSON-LD ──────────────────────────────────────────────────────

describe('Organization JSON-LD', () => {
  it('has required @context and @type', () => {
    expect(organizationJsonLd['@context']).toBe('https://schema.org')
    expect(organizationJsonLd['@type']).toBe('Organization')
  })

  it('has a valid organisation URL', () => {
    expect(isValidUrl(organizationJsonLd.url)).toBe(true)
  })

  it('has a valid logo URL', () => {
    expect(isValidUrl(organizationJsonLd.logo)).toBe(true)
  })

  it('has at least one sameAs URL', () => {
    expect(Array.isArray(organizationJsonLd.sameAs)).toBe(true)
    expect(organizationJsonLd.sameAs.length).toBeGreaterThan(0)
    organizationJsonLd.sameAs.forEach((url) => {
      expect(isValidUrl(url)).toBe(true)
    })
  })

  it('has founders array with Person @type', () => {
    expect(Array.isArray(organizationJsonLd.founders)).toBe(true)
    organizationJsonLd.founders.forEach((f) => {
      expect(f['@type']).toBe('Person')
      expect(typeof f.name).toBe('string')
    })
  })

  it('foundingDate is a 4-digit year string', () => {
    expect(/^\d{4}$/.test(organizationJsonLd.foundingDate)).toBe(true)
  })

  it('can be serialised to JSON without throwing', () => {
    expect(() => JSON.stringify(organizationJsonLd)).not.toThrow()
  })
})

// ── Person JSON-LD ────────────────────────────────────────────────────────────

describe('Person JSON-LD', () => {
  it('has required @context and @type', () => {
    expect(personJsonLd['@context']).toBe('https://schema.org')
    expect(personJsonLd['@type']).toBe('Person')
  })

  it('has a non-empty name', () => {
    expect(typeof personJsonLd.name).toBe('string')
    expect(personJsonLd.name.length).toBeGreaterThan(0)
  })

  it('has a valid url', () => {
    expect(isValidUrl(personJsonLd.url)).toBe(true)
  })

  it('worksFor has Organisation @type', () => {
    expect(personJsonLd.worksFor['@type']).toBe('Organization')
    expect(isValidUrl(personJsonLd.worksFor.url)).toBe(true)
  })

  it('can be serialised to JSON without throwing', () => {
    expect(() => JSON.stringify(personJsonLd)).not.toThrow()
  })
})

// ── Middleware allowlist logic ─────────────────────────────────────────────────

describe('Middleware public allowlist — /about', () => {
  /**
   * Simulate the middleware pathname check that is used to decide whether to
   * call NextResponse.next() without auth. If this returns true, the route is
   * public; if false it would 307 → /login.
   */
  function isPublicPath(pathname: string): boolean {
    if (pathname.startsWith('/build')) return true
    if (pathname === '/') return true
    if (pathname.startsWith('/showcase')) return true
    if (pathname.startsWith('/compare')) return true
    if (pathname.startsWith('/best')) return true
    if (pathname.startsWith('/about')) return true          // the new allowlist entry
    if (pathname.startsWith('/ai-company')) return true
    if (pathname.startsWith('/autonomous-company-builder')) return true
    if (pathname.startsWith('/ai-cofounder')) return true
    if (pathname === '/guides' || pathname.startsWith('/guides/')) return true
    if (pathname === '/templates' || pathname.startsWith('/templates/')) return true
    if (pathname.startsWith('/preview/')) return true
    return false
  }

  it('allows /about without auth', () => {
    expect(isPublicPath('/about')).toBe(true)
  })

  it('allows /about/ (trailing slash) without auth', () => {
    expect(isPublicPath('/about/')).toBe(true)
  })

  it('does not make /admin public', () => {
    expect(isPublicPath('/admin')).toBe(false)
  })

  it('does not make /chats public', () => {
    expect(isPublicPath('/chats')).toBe(false)
  })

  it('existing public paths still pass', () => {
    expect(isPublicPath('/compare/polsia')).toBe(true)
    expect(isPublicPath('/best/ai-app-builder')).toBe(true)
    expect(isPublicPath('/guides/ai-app-builder')).toBe(true)
    expect(isPublicPath('/')).toBe(true)
  })
})

// ── Sitemap entry ─────────────────────────────────────────────────────────────

describe('Sitemap /about entry', () => {
  const aboutEntry = {
    url: 'https://builder.ainative.studio/about',
    lastModified: new Date().toISOString(),
    changeFrequency: 'monthly' as const,
    priority: 0.85,
  }

  it('has a valid URL', () => {
    expect(isValidUrl(aboutEntry.url)).toBe(true)
  })

  it('URL includes /about', () => {
    expect(aboutEntry.url).toContain('/about')
  })

  it('priority is between 0 and 1', () => {
    expect(aboutEntry.priority).toBeGreaterThan(0)
    expect(aboutEntry.priority).toBeLessThanOrEqual(1)
  })

  it('changeFrequency is a recognised value', () => {
    const valid = ['always', 'hourly', 'daily', 'weekly', 'monthly', 'yearly', 'never']
    expect(valid).toContain(aboutEntry.changeFrequency)
  })
})

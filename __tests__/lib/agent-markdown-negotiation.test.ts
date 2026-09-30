import { describe, it, expect } from 'vitest'
import { prefersMarkdown, homepageMarkdown, notFoundMarkdown } from '@/lib/agent-markdown-negotiation'

describe('prefersMarkdown (AX/agent-readiness scan, 2026-09-30)', () => {
  it('is false with no Accept header', () => {
    expect(prefersMarkdown(null)).toBe(false)
  })

  it('is false for a plain Accept: text/html', () => {
    expect(prefersMarkdown('text/html')).toBe(false)
  })

  it('is true for a bare Accept: text/markdown', () => {
    expect(prefersMarkdown('text/markdown')).toBe(true)
  })

  it('is true when text/markdown is listed alongside other types with no q-values', () => {
    expect(prefersMarkdown('text/markdown, text/html, */*')).toBe(true)
  })

  it('is false when text/html has a strictly higher q-value than text/markdown', () => {
    expect(prefersMarkdown('text/markdown;q=0.5, text/html;q=0.9')).toBe(false)
  })

  it('is true when text/markdown has an equal or higher q-value than text/html', () => {
    expect(prefersMarkdown('text/markdown;q=0.9, text/html;q=0.5')).toBe(true)
    expect(prefersMarkdown('text/markdown;q=0.8, text/html;q=0.8')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(prefersMarkdown('Text/Markdown')).toBe(true)
  })
})

describe('homepageMarkdown', () => {
  it('returns a real, non-empty Markdown document with a top-level heading', () => {
    const md = homepageMarkdown()
    expect(md.startsWith('# ')).toBe(true)
    expect(md.length).toBeGreaterThan(20)
  })

  it('links to the sitemap-adjacent recovery resources', () => {
    const md = homepageMarkdown()
    expect(md).toContain('/llms.txt')
    expect(md).toContain('/openapi.json')
  })
})

describe('notFoundMarkdown', () => {
  it('names the real requested path', () => {
    const md = notFoundMarkdown('/this-page-does-not-exist')
    expect(md).toContain('/this-page-does-not-exist')
  })

  it('is at least 20 characters of real explanation, per the scan\'s own requirement', () => {
    const md = notFoundMarkdown('/x')
    expect(md.length).toBeGreaterThan(20)
  })

  it('points to the sitemap, llms.txt, and openapi.json for recovery', () => {
    const md = notFoundMarkdown('/x')
    expect(md).toContain('/sitemap.xml')
    expect(md).toContain('/llms.txt')
    expect(md).toContain('/openapi.json')
  })
})

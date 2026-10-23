import { describe, it, expect, vi, afterEach } from 'vitest'
import { analyzeHtml, fetchAndAssessSite } from '@/lib/build/site-assessment'

/**
 * #1306 — "Grow my existing business" gets a real but LIGHT assessment of
 * the founder's existing site: fetch the page, parse basic signals (title,
 * meta description, heading structure). No Lighthouse, no exhaustive SEO
 * audit — just small, honest parsing, with graceful failure handling.
 */

describe('analyzeHtml — pure HTML signal parsing (#1306)', () => {
  it('detects a present title tag and reports its text', () => {
    const html = '<html><head><title>Acme Plumbing Co</title></head><body></body></html>'
    const result = analyzeHtml(html)
    expect(result.hasTitle).toBe(true)
    expect(result.title).toBe('Acme Plumbing Co')
  })

  it('flags a missing title tag', () => {
    const html = '<html><head></head><body><h1>Hello</h1></body></html>'
    const result = analyzeHtml(html)
    expect(result.hasTitle).toBe(false)
    expect(result.title).toBe('')
  })

  it('detects a present meta description and reports its content', () => {
    const html = '<html><head><meta name="description" content="We fix pipes fast."></head></html>'
    const result = analyzeHtml(html)
    expect(result.hasMetaDescription).toBe(true)
    expect(result.metaDescription).toBe('We fix pipes fast.')
  })

  it('flags a missing meta description', () => {
    const html = '<html><head><title>x</title></head></html>'
    const result = analyzeHtml(html)
    expect(result.hasMetaDescription).toBe(false)
    expect(result.metaDescription).toBe('')
  })

  it('flags a thin meta description (under 50 chars) distinctly from missing', () => {
    const html = '<html><head><meta name="description" content="Short."></head></html>'
    const result = analyzeHtml(html)
    expect(result.hasMetaDescription).toBe(true)
    expect(result.metaDescriptionThin).toBe(true)
  })

  it('does not flag a substantial meta description as thin', () => {
    const html = '<html><head><meta name="description" content="We provide 24/7 emergency plumbing repair across the greater metro area with licensed technicians."></head></html>'
    const result = analyzeHtml(html)
    expect(result.metaDescriptionThin).toBe(false)
  })

  it('detects an h1 tag presence', () => {
    const html = '<html><body><h1>Welcome</h1></body></html>'
    expect(analyzeHtml(html).hasH1).toBe(true)
  })

  it('flags a missing h1 tag', () => {
    const html = '<html><body><h2>Welcome</h2></body></html>'
    expect(analyzeHtml(html).hasH1).toBe(false)
  })

  it('detects h2 presence independently of h1', () => {
    const html = '<html><body><h1>Title</h1><h2>Section</h2></body></html>'
    const result = analyzeHtml(html)
    expect(result.hasH1).toBe(true)
    expect(result.hasH2).toBe(true)
  })

  it('counts multiple h1 tags as a signal (more than one h1 is a real SEO issue)', () => {
    const html = '<html><body><h1>One</h1><h1>Two</h1></body></html>'
    expect(analyzeHtml(html).h1Count).toBe(2)
  })

  it('builds a short, honest human-readable summary of findings', () => {
    const html = '<html><head></head><body><h2>Sub</h2></body></html>'
    const result = analyzeHtml(html)
    expect(result.summary).toContain('no H1')
    expect(result.summary.toLowerCase()).toContain('title')
  })

  it('a fully healthy page summarizes positively with no gaps named', () => {
    const html = `<html><head><title>Acme</title><meta name="description" content="We provide 24/7 emergency plumbing repair across the greater metro area with licensed technicians."></head><body><h1>Acme Plumbing</h1><h2>Services</h2></body></html>`
    const result = analyzeHtml(html)
    expect(result.summary.toLowerCase()).toContain('looks healthy')
  })
})

describe('fetchAndAssessSite — real fetch + graceful failure (#1306)', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  it('rejects an invalid URL with a clear, honest error — no fetch attempted', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const result = await fetchAndAssessSite('not a url')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/invalid url/i)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns ok:true with parsed signals on a real 200 response', async () => {
    const html = '<html><head><title>Acme</title></head><body><h1>Hi</h1></body></html>'
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true, status: 200, text: async () => html,
    } as unknown as Response)))
    const result = await fetchAndAssessSite('https://acme.example.com')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.assessment.hasTitle).toBe(true)
      expect(result.assessment.hasH1).toBe(true)
    }
  })

  it('reports a clear, honest error on a non-200 response — never fakes success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: false, status: 404, text: async () => '',
    } as unknown as Response)))
    const result = await fetchAndAssessSite('https://acme.example.com/missing')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toMatch(/404/)
  })

  it('reports a clear, honest error on a network/timeout failure — never crashes', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('timeout') }))
    const result = await fetchAndAssessSite('https://unreachable.example.com')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.error).toBeTruthy()
  })

  it('normalizes a bare domain (no scheme) into a real fetchable URL', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true, status: 200, text: async () => '<html></html>',
    } as unknown as Response))
    vi.stubGlobal('fetch', fetchMock)
    await fetchAndAssessSite('acme.example.com')
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringMatching(/^https?:\/\/acme\.example\.com/),
      expect.anything(),
    )
  })
})

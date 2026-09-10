import { describe, it, expect } from 'vitest'
import { extractShowcaseTitle } from '@/lib/showcase-data'

/**
 * Real bug found live (2026-09-10): the public showcase was flooded with
 * dozens of entries literally titled "Polished, Working Web App For This"
 * and "Polished, Production-quality Single-page Marketing LANDING PAGE" —
 * because every real generation prompt (App track and Company track alike)
 * wraps the founder's actual idea in one of a few fixed template phrasings,
 * and the OLD title logic just took the first few words of the WHOLE
 * prompt, which is always the generic wrapper, never the real idea.
 * extractShowcaseTitle fixes this by stripping each known wrapper phrase
 * first, so the extracted title reflects the real idea/company name.
 */
describe('extractShowcaseTitle', () => {
  it('extracts the real idea from the App-track wrapper (lib/build/useRealPreview.ts)', () => {
    const prompt =
      'Build a polished, working web app for this idea: a freelance consulting invoicing tool that lets me create invoices, send them to clients, and track which ones have been paid. Make it interactive and visually complete with realistic sample data.'
    const title = extractShowcaseTitle(prompt)
    expect(title.toLowerCase()).not.toContain('polished')
    expect(title.toLowerCase()).not.toContain('working web app')
    expect(title.toLowerCase()).toContain('freelance')
  })

  it('extracts the real idea from the Company-product wrapper (app/api/build/company-product/route.ts)', () => {
    const prompt =
      'Build a real, working, functional application for "Meridian" that actually implements this idea: A personalized business advisor that analyzes customer interactions, sales pipeline data, and market intelligence to forecast revenue and recommend strategic actions. This is the founder\'s REAL, WORKING TOOL — not a marketing page.'
    const title = extractShowcaseTitle(prompt)
    expect(title.toLowerCase()).not.toContain('real, working, functional')
    expect(title.toLowerCase()).toContain('personalized business advisor')
  })

  it('extracts the company name from the landing-page wrapper (app/api/build/company-app/route.ts)', () => {
    const prompt = 'Build a polished, production-quality single-page marketing LANDING PAGE for "Atlas Coffee" — a company that...'
    const title = extractShowcaseTitle(prompt)
    expect(title.toLowerCase()).not.toContain('polished, production-quality')
    expect(title).toContain('Atlas Coffee')
  })

  it('two different real ideas using the SAME wrapper produce two DIFFERENT titles (the core bug)', () => {
    const invoicing = extractShowcaseTitle(
      'Build a polished, working web app for this idea: a freelance consulting invoicing tool. Make it interactive.',
    )
    const helpdesk = extractShowcaseTitle(
      'Build a polished, working web app for this idea: a customer support helpdesk with a ticket queue. Make it interactive.',
    )
    expect(invoicing).not.toBe(helpdesk)
  })

  it('still handles a plain "Build a/an X" prompt with no special wrapper', () => {
    const title = extractShowcaseTitle('Build a todo list app with drag and drop reordering.')
    expect(title.toLowerCase()).toContain('todo list app')
  })

  it('falls back to "Untitled" for empty input', () => {
    expect(extractShowcaseTitle('')).toBe('Untitled')
  })

  it('title-cases each word and caps at 8 words', () => {
    const title = extractShowcaseTitle('Build a very long idea description that goes on and on past eight words for sure')
    expect(title.split(' ').length).toBeLessThanOrEqual(8)
    expect(title[0]).toBe(title[0].toUpperCase())
  })
})

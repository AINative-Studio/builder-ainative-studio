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

  // #955 — real bug found live (2026-10-06): showcase cards for company-app
  // (landing-page-only) generations rendered titles like
  // `"Wrench" (tagline: "From Job Site To Paid —` — raw template syntax
  // (quote marks, the literal word "tagline:", a mid-sentence truncation)
  // leaking straight into the public UI. Root cause: company-app/route.ts's
  // message template ALWAYS includes `(tagline: "...")` right after the
  // quoted name whenever a tagline exists (line 207: `(tagline ? \`
  // (tagline: "${tagline}")\` : '')`), but the 'Atlas Coffee' test above
  // only covers the taglineless shape — extractShowcaseTitle's wrapper-strip
  // left the tagline parenthetical untouched, so the 8-word truncation cut
  // off mid-parenthetical.
  it('extracts just the company name when the landing-page wrapper includes a tagline (#955)', () => {
    const prompt =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Wrench" (tagline: "From Job Site To Paid — on autopilot.") — a real company for this idea: automates scheduling, invoicing, and customer updates so plumbers, electricians, and HVAC pros can stop chasing paperwork.'
    const title = extractShowcaseTitle(prompt)
    expect(title).toBe('Wrench')
    expect(title).not.toContain('tagline')
    expect(title).not.toContain('"')
    expect(title).not.toContain('(')
  })

  it('still extracts the company name when the landing-page wrapper has NO tagline (#955 regression guard)', () => {
    const prompt =
      'Build a polished, production-quality single-page marketing LANDING PAGE for "Shutter" — a real company for this idea: an all-in-one workspace for freelance photographers.'
    const title = extractShowcaseTitle(prompt)
    expect(title).toBe('Shutter')
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

  // #958 — real bug found live on production (2026-10-06), human-testing
  // #955's fix: a real founder's prompt that doesn't match any known
  // template wrapper fell through to the generic 8-word truncation, which
  // for a natural first-person idea description produces a nonsense title
  // (a raw sentence fragment, not a business name). Real production example
  // (a genuinely good idea — "LinkedIn for volunteer firefighters"):
  // "I would like to build an app that connects volunteer firefighters to
  // real stations..." rendered as the showcase title literally
  // "I Would Like To Build An App That". Fix: strip the same handful of
  // extremely common first-person openings the way the wrapper regexes
  // already strip the app's OWN template phrasing, before falling through
  // to word-truncation.
  it('strips "I would like to build an app that" before truncating (#958)', () => {
    const prompt =
      'I would like to build an app that connects volunteer firefighters to real stations. I would like the captains to be able to go on and see each persons page.'
    const title = extractShowcaseTitle(prompt)
    expect(title.toLowerCase()).not.toContain('i would like')
    expect(title.toLowerCase()).toContain('connects volunteer firefighters')
  })

  it('strips the same prompt when it arrives wrapped in the App-track template (#958)', () => {
    const prompt =
      'Build a polished, working web app for this idea: I would like to build an app that connects volunteer firefighters to real stations. Make it interactive.'
    const title = extractShowcaseTitle(prompt)
    expect(title.toLowerCase()).not.toContain('i would like')
    expect(title.toLowerCase()).toContain('connects volunteer firefighters')
  })

  it('strips "I want to build a/an X"', () => {
    const title = extractShowcaseTitle('I want to build a marketplace for local artisans to sell handmade goods.')
    expect(title.toLowerCase()).not.toContain('i want')
    expect(title.toLowerCase()).toContain('marketplace for local artisans')
  })

  it('strips "I\'m building a/an X"', () => {
    const title = extractShowcaseTitle("I'm building a scheduling tool for yoga studios.")
    expect(title.toLowerCase()).not.toContain("i'm building")
    expect(title.toLowerCase()).toContain('scheduling tool for yoga studios')
  })

  it('strips "I need an app that X"', () => {
    const title = extractShowcaseTitle('I need an app that tracks inventory for my small bakery.')
    expect(title.toLowerCase()).not.toContain('i need')
    expect(title.toLowerCase()).toContain('tracks inventory for my small bakery')
  })
})

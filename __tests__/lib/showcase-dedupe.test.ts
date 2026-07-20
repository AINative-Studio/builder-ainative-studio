import { describe, it, expect } from 'vitest'
import {
  combineAndDedupeShowcase,
  normalizePromptKey,
  type ShowcaseEntry,
} from '@/lib/showcase-data'

const entry = (o: Partial<ShowcaseEntry>): ShowcaseEntry => ({
  slug: o.slug || 'slug',
  title: o.title || 'Title',
  description: '',
  category: o.category || 'creative',
  prompt: o.prompt || '',
  chatId: o.chatId,
  tags: [],
  featured: o.featured || false,
  createdAt: o.createdAt || '2026-07-01',
  ...o,
})

describe('normalizePromptKey', () => {
  it('collapses "Build a X" / "Build an X" and punctuation/case', () => {
    const a = normalizePromptKey('Build a Todo List App!')
    const b = normalizePromptKey('build an   todo list app')
    // "a"/"an" stripped, lowercased, punctuation → spaces
    expect(a).toBe('todo list app')
    expect(b).toBe('todo list app')
  })
  it('is empty for empty prompt', () => {
    expect(normalizePromptKey('')).toBe('')
  })
})

describe('combineAndDedupeShowcase', () => {
  it('collapses repeated prompts to the NEWEST generation', () => {
    const dynamic = [
      entry({ chatId: 'c1', prompt: 'Build a ZeroCommerce storefront', createdAt: '2026-07-10' }),
      entry({ chatId: 'c2', prompt: 'Build a ZeroCommerce storefront', createdAt: '2026-07-18' }), // newest
      entry({ chatId: 'c3', prompt: 'Build a ZeroCommerce storefront', createdAt: '2026-07-12' }),
    ]
    const out = combineAndDedupeShowcase([], dynamic)
    const commerce = out.filter(e => normalizePromptKey(e.prompt) === 'zerocommerce storefront')
    expect(commerce).toHaveLength(1)
    expect(commerce[0].chatId).toBe('c2') // the 07-18 one
  })

  it('keeps distinct prompts', () => {
    const dynamic = [
      entry({ chatId: 'a', prompt: 'Build a todo app' }),
      entry({ chatId: 'b', prompt: 'Build a kanban board' }),
      entry({ chatId: 'c', prompt: 'Build a CRM' }),
    ]
    const out = combineAndDedupeShowcase([], dynamic)
    expect(out).toHaveLength(3)
  })

  it('dedupes by chatId as well (same chatId appears once)', () => {
    const dynamic = [
      entry({ chatId: 'dup', prompt: 'Build a todo app', createdAt: '2026-07-10' }),
      entry({ chatId: 'dup', prompt: 'Build a todo app', createdAt: '2026-07-10' }),
    ]
    expect(combineAndDedupeShowcase([], dynamic)).toHaveLength(1)
  })

  it('never drops seed entries and does not prompt-dedupe them away', () => {
    const seed = [entry({ slug: 'seed-1', prompt: 'Build a dashboard', featured: true })]
    const dynamic = [entry({ chatId: 'x', prompt: 'Build a dashboard' })] // same prompt as seed
    const out = combineAndDedupeShowcase(seed, dynamic)
    // seed kept; the dynamic dup of the same prompt is also kept because seed
    // isn't added to the prompt-seen set — seeds are curated, dynamic collapse
    // only applies among dynamic entries.
    expect(out.some(e => e.slug === 'seed-1')).toBe(true)
  })

  it('does NOT merge multiple empty-prompt entries into one', () => {
    const dynamic = [
      entry({ chatId: 'e1', prompt: '' }),
      entry({ chatId: 'e2', prompt: '' }),
    ]
    expect(combineAndDedupeShowcase([], dynamic)).toHaveLength(2)
  })

  it('sorts NEWEST-first so fresh generations surface (featured is NOT sticky over date)', () => {
    // A featured seed dated in the past must NOT bury newer generations — that
    // was the "latest designs not surfacing" bug.
    const seed = [entry({ slug: 'feat', prompt: 'x', featured: true, createdAt: '2026-01-01' })]
    const dynamic = [
      entry({ chatId: 'old', prompt: 'Build a old thing', createdAt: '2026-07-01' }),
      entry({ chatId: 'new', prompt: 'Build a new thing', createdAt: '2026-07-19' }),
    ]
    const out = combineAndDedupeShowcase(seed, dynamic)
    expect(out[0].chatId).toBe('new') // newest first, NOT the old featured seed
    expect(out[1].chatId).toBe('old')
    expect(out[2].slug).toBe('feat') // the Jan featured seed sinks to the bottom by date
  })

  it('featured wins only as a SAME-DATE tiebreaker', () => {
    const seed = [entry({ slug: 'feat', prompt: 'x', featured: true, createdAt: '2026-07-20' })]
    const dynamic = [entry({ chatId: 'plain', prompt: 'Build a thing', createdAt: '2026-07-20' })]
    const out = combineAndDedupeShowcase(seed, dynamic)
    expect(out[0].slug).toBe('feat') // same date → featured first
  })
})

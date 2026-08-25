import { describe, it, expect } from 'vitest'
import {
  scorePrimitives,
  selectPrimitives,
  getPrimitive,
  CATALOG,
} from '@/lib/build/primitive-catalog'
import { buildSystems } from '@/lib/build/business-systems'

/**
 * #72 — Cody picked generic business-ops primitives (ZeroPipeline/ZeroInvoice/
 * ZeroCommerce) for a social-media idea. Two bugs: (1) no social/community/feed
 * triggers in the catalog, (2) the systems grid was filtered to business-ops
 * only and fell back to ZeroPipeline/ZeroInvoice defaults. These tests lock in
 * genuine idea-driven matching across social + other non-business-ops domains.
 */

const SOCIAL_IDEA =
  'a college social network — what Facebook was supposed to be — with a feed of ' +
  'posts, comments, likes, followers/following connections, profiles and messaging'

const BUSINESS_OP_DEFAULTS = ['ZeroInvoice', 'ZeroCommerce', 'ZeroPipeline']

describe('#72 catalog has real social/community primitives + triggers', () => {
  it('exposes the real Social Graph primitive from docs §9', () => {
    const p = getPrimitive('Social Graph')
    expect(p).toBeDefined()
    expect(p!.category).toBe('community')
    expect(p!.url).toContain('/community/social-graph')
    // followers/following/connections must be recognized triggers
    for (const t of ['followers', 'following', 'connections', 'social graph']) {
      expect(p!.triggers).toContain(t)
    }
  })

  it('exposes the real Community primitive from docs §9', () => {
    const p = getPrimitive('Community')
    expect(p).toBeDefined()
    expect(p!.category).toBe('community')
    expect(p!.url).toContain('/community/overview')
  })

  it('Context Graph gains social-graph triggers (models users ↔ connections)', () => {
    const p = getPrimitive('Context Graph')!
    for (const t of ['social graph', 'followers', 'following', 'friends', 'network', 'profiles']) {
      expect(p.triggers).toContain(t)
    }
  })

  it('ZeroDB is recognized as the social data store (posts/feed/comments)', () => {
    const p = getPrimitive('ZeroDB')!
    for (const t of ['posts', 'feed', 'comments', 'likes', 'timeline', 'messages']) {
      expect(p.triggers).toContain(t)
    }
  })

  it('Search & Discovery gains social/community/people triggers', () => {
    const p = getPrimitive('Search & Discovery')!
    for (const t of ['social', 'community', 'people']) {
      expect(p.triggers).toContain(t)
    }
  })
})

describe('#72 scorePrimitives matches social/community concepts', () => {
  it('scores social/community primitives for a social-media idea', () => {
    const scored = scorePrimitives(SOCIAL_IDEA, 'company')
    const byName = new Map(scored.map((s) => [s.primitive.name, s]))

    // Each social primitive must actually match at least one trigger.
    for (const name of ['Social Graph', 'Community', 'Context Graph']) {
      expect(byName.get(name)!.matched.length).toBeGreaterThan(0)
    }
    // ZeroDB (foundational) matches on posts/feed/comments.
    expect(byName.get('ZeroDB')!.matched.length).toBeGreaterThan(0)
  })

  it('ranks a social/community primitive above the business-ops defaults', () => {
    const scored = scorePrimitives(SOCIAL_IDEA, 'company')
    const rank = (n: string) => scored.findIndex((s) => s.primitive.name === n)
    const socialRank = rank('Social Graph')
    expect(socialRank).toBeGreaterThanOrEqual(0)
    // Social Graph should outrank generic billing/commerce (which shouldn't match at all).
    for (const def of ['ZeroInvoice', 'ZeroCommerce']) {
      expect(socialRank).toBeLessThan(rank(def))
    }
  })

  it('does NOT match ZeroInvoice/ZeroCommerce for a purely social idea', () => {
    const scored = scorePrimitives(SOCIAL_IDEA, 'company')
    const byName = new Map(scored.map((s) => [s.primitive.name, s]))
    expect(byName.get('ZeroInvoice')!.matched.length).toBe(0)
    expect(byName.get('ZeroCommerce')!.matched.length).toBe(0)
  })
})

describe('#72 selectPrimitives surfaces social primitives, not billing/commerce', () => {
  it('includes social-graph + community in the selected set', () => {
    const { names } = selectPrimitives(SOCIAL_IDEA, 'company')
    expect(names).toContain('Social Graph')
    expect(names).toContain('Community')
  })

  it('does not surface ZeroInvoice/ZeroCommerce for a social idea', () => {
    const { selected } = selectPrimitives(SOCIAL_IDEA, 'company')
    const selNames = selected.map((p) => p.name)
    expect(selNames).not.toContain('ZeroInvoice')
    expect(selNames).not.toContain('ZeroCommerce')
  })
})

describe('#72 buildSystems grid is idea-appropriate, not business-ops-biased', () => {
  it('social app selects social/community/data primitives and NOT ZeroInvoice/ZeroCommerce/ZeroPipeline', () => {
    const systems = buildSystems(SOCIAL_IDEA)
    const names = systems.map((s) => s.primitive)

    // Must surface the social-capable primitives.
    expect(names).toContain('Social Graph')
    expect(
      names.some((n) => ['Community', 'Context Graph', 'Search & Discovery', 'ZeroDB'].includes(n)),
    ).toBe(true)

    // Must NOT default a social app into the generic business-ops set.
    for (const def of BUSINESS_OP_DEFAULTS) {
      expect(names).not.toContain(def)
    }
  })

  it('social system cards carry docUrls and honest zero-state stats', () => {
    const systems = buildSystems(SOCIAL_IDEA)
    const social = systems.find((s) => s.primitive === 'Social Graph')!
    expect(social.docUrl).toMatch(/^https:\/\//)
    expect(social.count).toBe(0)
    expect(social.stat).toMatch(/Ready/)
    expect(social.url).toBeUndefined() // unprovisioned → non-navigating
  })

  it('note-taking app leads with data primitives (ZeroDB / Search), not billing', () => {
    const systems = buildSystems('a personal note-taking app to write, save and search notes')
    const names = systems.map((s) => s.primitive)
    // A real data primitive must be surfaced, and it must lead the grid.
    expect(names[0]).toBe('ZeroDB')
    expect(names).toContain('Search & Discovery')
    // The idea match must come before any backfilled business-ops default.
    const firstDefault = names.findIndex((n) => BUSINESS_OP_DEFAULTS.includes(n))
    const zdbIdx = names.indexOf('ZeroDB')
    if (firstDefault !== -1) expect(zdbIdx).toBeLessThan(firstDefault)
  })

  it('a game with persisted scores surfaces ZeroDB (idea match) ahead of business-ops fallback', () => {
    const systems = buildSystems(
      'a browser puzzle game that saves player high scores and data to a leaderboard',
    )
    const names = systems.map((s) => s.primitive)
    expect(names).toContain('ZeroDB')
    const firstDefault = names.findIndex((n) => BUSINESS_OP_DEFAULTS.includes(n))
    const zdbIdx = names.indexOf('ZeroDB')
    if (firstDefault !== -1) expect(zdbIdx).toBeLessThan(firstDefault)
  })

  it('business-ops ideas still select their business-ops primitive (no regression)', () => {
    expect(buildSystems('B2B sales CRM pipeline deals').map((s) => s.primitive)).toContain(
      'ZeroPipeline',
    )
    expect(buildSystems('online coffee shop selling beans and merch').map((s) => s.primitive)).toContain(
      'ZeroCommerce',
    )
    expect(
      buildSystems('startup equity cap table fundraising SAFE').map((s) => s.primitive),
    ).toContain('OpenCapStack')
  })

  it('business-ops defaults only backfill when the idea matched too few primitives', () => {
    // Empty idea → nothing matches → grid filled from business-ops defaults.
    const empty = buildSystems()
    expect(empty.length).toBeGreaterThan(0)
    expect(empty.every((s) => s.count === 0)).toBe(true)
    // Every catalog card name is real.
    const catalogNames = new Set(CATALOG.map((p) => p.name))
    for (const s of empty) expect(catalogNames.has(s.primitive)).toBe(true)
  })
})

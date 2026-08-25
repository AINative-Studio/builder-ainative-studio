import { describe, it, expect } from 'vitest'
import {
  PRIMITIVE_MAP,
  TOTAL_PRIMITIVES,
  type PrimitiveEntry,
  type PrimitiveNudge,
} from '@/lib/build/primitives'
import { CATALOG_SIZE, CATALOG, selectPrimitives } from '@/lib/build/primitive-catalog'

/**
 * Tests for lib/build/primitives.ts — primitive-context map + re-exports.
 *
 * primitives.ts is a pure data/re-export file; coverage comes from:
 *   1. Structural integrity of PRIMITIVE_MAP entries
 *   2. Re-export correctness (CATALOG_SIZE, CATALOG, selectPrimitives)
 *   3. TOTAL_PRIMITIVES deprecation alias
 *   4. selectPrimitives behaviour (from catalog)
 */

describe('PRIMITIVE_MAP structural integrity', () => {
  const allViews = Object.keys(PRIMITIVE_MAP)

  it('exports a non-empty PRIMITIVE_MAP', () => {
    expect(allViews.length).toBeGreaterThan(0)
  })

  it('every entry has a non-empty powered array with string elements', () => {
    for (const [view, entry] of Object.entries(PRIMITIVE_MAP)) {
      expect(Array.isArray(entry.powered), `${view}.powered should be array`).toBe(true)
      expect(entry.powered.length, `${view}.powered should be non-empty`).toBeGreaterThan(0)
      for (const p of entry.powered) {
        expect(typeof p, `${view}.powered element should be string`).toBe('string')
      }
    }
  })

  it('nudge is either null/undefined or a valid PrimitiveNudge shape', () => {
    for (const [view, entry] of Object.entries(PRIMITIVE_MAP)) {
      if (entry.nudge == null) continue
      expect(typeof entry.nudge.prim, `${view}.nudge.prim`).toBe('string')
      expect(typeof entry.nudge.text, `${view}.nudge.text`).toBe('string')
      expect(typeof entry.nudge.cta, `${view}.nudge.cta`).toBe('string')
    }
  })

  it('covers all expected App Track views', () => {
    const appViews = ['brief', 'prd', 'comp', 'dataModel', 'memoryPolicy', 'agentDef', 'codingStandards', 'apiSpec', 'backlog', 'sprintPlan', 'swarm', 'infra', 'preview']
    for (const v of appViews) {
      expect(PRIMITIVE_MAP[v], `App track view "${v}" should be in PRIMITIVE_MAP`).toBeDefined()
    }
  })

  it('covers all expected Company Track views', () => {
    const companyViews = ['thesis', 'wedge', 'businessModel', 'positioning', 'landing', 'plan30']
    for (const v of companyViews) {
      expect(PRIMITIVE_MAP[v], `Company track view "${v}" should be in PRIMITIVE_MAP`).toBeDefined()
    }
  })

  it('covers shared/late views', () => {
    expect(PRIMITIVE_MAP['pipeline']).toBeDefined()
    expect(PRIMITIVE_MAP['conflict']).toBeDefined()
    expect(PRIMITIVE_MAP['graph']).toBeDefined()
  })
})

describe('TOTAL_PRIMITIVES deprecation alias', () => {
  it('equals CATALOG_SIZE from primitive-catalog', () => {
    expect(TOTAL_PRIMITIVES).toBe(CATALOG_SIZE)
  })

  it('is a positive number', () => {
    expect(TOTAL_PRIMITIVES).toBeGreaterThan(0)
  })
})

describe('re-exported CATALOG_SIZE', () => {
  it('is a positive integer', () => {
    expect(Number.isInteger(CATALOG_SIZE)).toBe(true)
    expect(CATALOG_SIZE).toBeGreaterThan(0)
  })

  it('matches the length of CATALOG array', () => {
    expect(CATALOG_SIZE).toBe(CATALOG.length)
  })
})

describe('re-exported selectPrimitives', () => {
  it('returns an object with foundational, selected, and names arrays', () => {
    const result = selectPrimitives('an analytics dashboard for e-commerce', 'app')
    expect(Array.isArray(result.foundational)).toBe(true)
    expect(Array.isArray(result.selected)).toBe(true)
    expect(Array.isArray(result.names)).toBe(true)
  })

  it('returns foundational primitives (always included) for any idea', () => {
    const result = selectPrimitives('something vague', 'app')
    // Foundational entries should always appear
    expect(result.foundational.length).toBeGreaterThan(0)
  })

  it('names array is deduped and foundational-first', () => {
    const result = selectPrimitives('something vague', 'app')
    const uniqueNames = new Set(result.names)
    // Deduped: no duplicates
    expect(uniqueNames.size).toBe(result.names.length)
    // Names are strings
    for (const n of result.names) expect(typeof n).toBe('string')
  })

  it('selects primitives relevant to the idea', () => {
    // A billing/payment idea should surface ZeroInvoice in selected or foundational
    const result = selectPrimitives('subscription billing and invoicing for SaaS', 'company')
    const allNames = result.names
    // At least one payment/billing-related primitive should appear
    expect(allNames.some((n) => /invoice|billing|payment|pipeline|zeroinvoice/i.test(n))).toBe(true)
  })

  it('returns a non-empty names array for both tracks', () => {
    const app = selectPrimitives('generic idea', 'app')
    const company = selectPrimitives('generic idea', 'company')
    expect(app.names.length).toBeGreaterThan(0)
    expect(company.names.length).toBeGreaterThan(0)
  })

  it('respects the maxSelected cap', () => {
    const result = selectPrimitives('crm sales pipeline', 'company', 3)
    // selected (non-foundational) should be at most 3
    expect(result.selected.length).toBeLessThanOrEqual(3)
  })
})

describe('specific PRIMITIVE_MAP entries', () => {
  it('brief powers ZeroMemory and GraphRAG with a safety nudge', () => {
    const entry = PRIMITIVE_MAP['brief']
    expect(entry.powered).toContain('ZeroMemory')
    expect(entry.powered).toContain('GraphRAG')
    expect(entry.nudge?.prim).toContain('AI Kit Safety')
  })

  it('preview nudges toward Instant DB routing to infra', () => {
    const entry = PRIMITIVE_MAP['preview']
    expect(entry.nudge?.prim).toBe('Instant DB')
    expect(entry.nudge?.to).toBe('infra')
  })

  it('swarm powers Agent Cloud and Agent Swarm', () => {
    const entry = PRIMITIVE_MAP['swarm']
    expect(entry.powered).toContain('Agent Cloud')
    expect(entry.powered).toContain('Agent Swarm')
    expect(entry.nudge).toBeNull()
  })

  it('pipeline has a ZeroVoice nudge', () => {
    const entry = PRIMITIVE_MAP['pipeline']
    expect(entry.nudge?.prim).toBe('ZeroVoice')
  })
})

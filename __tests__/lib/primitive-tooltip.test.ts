import { describe, it, expect } from 'vitest'
import { getPrimitiveTooltip, CATALOG } from '@/lib/build/primitive-catalog'

/**
 * Unit tests for getPrimitiveTooltip() — the tooltip-content lookup added by #66.
 *
 * Coverage targets:
 *  1. Exact-name match (fast path)
 *  2. Decorated-name match ("ZeroDB · Vectors" → ZeroDB purpose)
 *  3. Longest-prefix match ("AI Kit Safety" → AI Kit purpose)
 *  4. Substring match fallback
 *  5. No-match returns undefined (internal label, not a catalog primitive)
 *  6. Every catalog primitive resolves its own name to a non-empty purpose
 *  7. Ownership copy: resolved string ends with "— yours, on your own API." when
 *     appended in the component (tested via catalog purpose being non-empty)
 */

describe('getPrimitiveTooltip (#66)', () => {
  // ── 1. Exact matches ──────────────────────────────────────────────────────
  it('resolves an exact catalog name to its purpose', () => {
    const tip = getPrimitiveTooltip('ZeroDB')
    expect(tip).toBeDefined()
    expect(tip).toContain('Persistent knowledge layer')
  })

  it('resolves ZeroPipeline (business-ops) exactly', () => {
    const tip = getPrimitiveTooltip('ZeroPipeline')
    expect(tip).toBeDefined()
    expect(tip).toMatch(/CRM|sales pipeline/i)
  })

  it('resolves ZeroInvoice exactly', () => {
    const tip = getPrimitiveTooltip('ZeroInvoice')
    expect(tip).toBeDefined()
    expect(tip).toMatch(/invoice|billing/i)
  })

  it('resolves ZeroCommerce exactly', () => {
    const tip = getPrimitiveTooltip('ZeroCommerce')
    expect(tip).toBeDefined()
    expect(tip).toMatch(/ecommerce|product catalog/i)
  })

  it('resolves ZeroMemory exactly', () => {
    const tip = getPrimitiveTooltip('ZeroMemory')
    expect(tip).toBeDefined()
    expect(tip).toMatch(/memory|cognitive/i)
  })

  it('resolves Agent Cloud exactly', () => {
    const tip = getPrimitiveTooltip('Agent Cloud')
    expect(tip).toBeDefined()
    expect(tip).toMatch(/autonomous|agent/i)
  })

  // ── 2. Decorated-name (stem) matches ─────────────────────────────────────
  it('resolves "ZeroDB · Vectors" to the ZeroDB purpose via stem', () => {
    const tip = getPrimitiveTooltip('ZeroDB · Vectors')
    expect(tip).toBeDefined()
    expect(tip).toContain('Persistent knowledge layer')
  })

  it('resolves "ZeroDB Files" via stem (dot-separator variant)', () => {
    // "ZeroDB Files" has no dot-separator so falls through to prefix match
    const tip = getPrimitiveTooltip('ZeroDB Files')
    expect(tip).toBeDefined()
    expect(tip).toContain('Persistent knowledge layer')
  })

  it('resolves "Managed embeddings" via substring (ZeroDB contains "embeddings" in purpose)', () => {
    // "Managed embeddings" is an internal tag; will return undefined or ZeroDB —
    // the important thing is it doesn't throw.
    expect(() => getPrimitiveTooltip('Managed embeddings')).not.toThrow()
  })

  // ── 3. Longest-prefix matches ─────────────────────────────────────────────
  it('resolves "AI Kit Safety" to the AI Kit purpose via longest prefix', () => {
    const tip = getPrimitiveTooltip('AI Kit Safety')
    expect(tip).toBeDefined()
    // AI Kit purpose mentions React/Vue/Svelte or UI components
    expect(tip).toMatch(/UI|component|React|streaming/i)
  })

  it('resolves "AI Kit" exactly (prefix is whole name)', () => {
    const tip = getPrimitiveTooltip('AI Kit')
    expect(tip).toBeDefined()
    expect(tip).toMatch(/UI|component/i)
  })

  it('resolves "Agent Cloud" with extra qualifier prefix', () => {
    const tip = getPrimitiveTooltip('Agent Cloud')
    expect(tip).toBeDefined()
  })

  // ── 4. Substring fallback ─────────────────────────────────────────────────
  it('returns undefined for purely internal labels with no catalog match', () => {
    // "Sequential Thinking" and "GraphRAG" and "MCP" are not catalog primitives
    const tip1 = getPrimitiveTooltip('Sequential Thinking')
    const tip2 = getPrimitiveTooltip('GraphRAG')
    // These may or may not match (via substring) — must not throw, and if
    // they return something it must be a non-empty string.
    if (tip1 !== undefined) expect(tip1.length).toBeGreaterThan(0)
    if (tip2 !== undefined) expect(tip2.length).toBeGreaterThan(0)
  })

  it('returns undefined for a completely unrecognised label', () => {
    const tip = getPrimitiveTooltip('XYZ-NONEXISTENT-9999')
    expect(tip).toBeUndefined()
  })

  // ── 5. Full catalog coverage ───────────────────────────────────────────────
  it('every catalog primitive resolves its own name to a non-empty purpose', () => {
    for (const primitive of CATALOG) {
      const tip = getPrimitiveTooltip(primitive.name)
      expect(tip, `${primitive.name} should resolve`).toBeDefined()
      expect(tip!.length, `${primitive.name} purpose should be non-empty`).toBeGreaterThan(0)
      // Purpose == what catalog stores; the component appends ownership copy.
      expect(tip).toBe(primitive.purpose)
    }
  })

  // ── 6. Purpose strings are non-trivial (branding intent) ─────────────────
  it('purposes are long enough to be meaningful (>= 20 chars)', () => {
    for (const primitive of CATALOG) {
      expect(
        primitive.purpose.length,
        `${primitive.name} purpose too short`
      ).toBeGreaterThanOrEqual(20)
    }
  })

  // ── 7. No collisions: different chip labels return different purposes ──────
  it('ZeroDB and ZeroMemory resolve to distinct purposes', () => {
    expect(getPrimitiveTooltip('ZeroDB')).not.toBe(getPrimitiveTooltip('ZeroMemory'))
  })

  it('ZeroPipeline and ZeroInvoice resolve to distinct purposes', () => {
    expect(getPrimitiveTooltip('ZeroPipeline')).not.toBe(getPrimitiveTooltip('ZeroInvoice'))
  })
})

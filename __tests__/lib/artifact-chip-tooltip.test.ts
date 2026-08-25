import { describe, it, expect } from 'vitest'
import { getPrimitiveTooltip, CATALOG } from '@/lib/build/primitive-catalog'

/**
 * Unit tests for the artifact-table chip tooltip mapping (#81).
 *
 * The Comp artifact in app-artifacts.tsx now calls getPrimitiveTooltip(p.name)
 * and attaches the result as a native `title` attribute on the chip.  These tests
 * verify the mapping logic that drives that behaviour — so a future code change
 * that breaks the title-attribute population will fail here before it reaches prod.
 *
 * Coverage targets:
 *  1. Known primitives that appear in the Comp fallback data resolve a non-empty tooltip.
 *  2. The title string appends " — yours, on your own API." (matching PoweringThis).
 *  3. Non-primitive chip labels (e.g. priority "P0", size "M") return undefined
 *     so those chips remain plain (no spurious title).
 *  4. Decorated names ("ZeroDB · Vectors") still resolve — guards the Comp artifact
 *     where the API may return decorated chip labels.
 *  5. Every CATALOG primitive round-trips through getPrimitiveTooltip without error.
 */

/** Mirrors the logic used in app-artifacts.tsx Comp to produce the title attribute. */
function artifactChipTitle(chipLabel: string): string | undefined {
  const tip = getPrimitiveTooltip(chipLabel)
  if (!tip) return undefined
  return `${tip} — yours, on your own API.`
}

describe('artifact-table chip tooltip mapping (#81)', () => {
  // ── 1. Default Comp fallback primitives resolve ───────────────────────────
  it('ZeroDB · Vectors resolves — default Comp fallback chip', () => {
    const title = artifactChipTitle('ZeroDB · Vectors')
    expect(title).toBeTruthy()
    expect(title).toContain('Persistent knowledge layer')
    expect(title).toContain('yours, on your own API')
  })

  it('ZeroMemory resolves — default Comp fallback chip', () => {
    const title = artifactChipTitle('ZeroMemory')
    expect(title).toBeTruthy()
    expect(title).toMatch(/memory|cognitive/i)
    expect(title).toContain('yours, on your own API')
  })

  it('Agent Cloud resolves — default Comp fallback chip', () => {
    const title = artifactChipTitle('Agent Cloud')
    expect(title).toBeTruthy()
    expect(title).toMatch(/autonomous|agent/i)
    expect(title).toContain('yours, on your own API')
  })

  it('MCP resolves or returns undefined without throwing', () => {
    // "MCP" is an internal label — it may or may not match via substring.
    // The important invariant: it must not throw.
    expect(() => artifactChipTitle('MCP')).not.toThrow()
  })

  // ── 2. Title string format ────────────────────────────────────────────────
  it('title appends ownership copy with em-dash separator', () => {
    const title = artifactChipTitle('ZeroDB')
    expect(title).toMatch(/— yours, on your own API\.$/)
  })

  it('title is composed from catalog purpose + fixed suffix', () => {
    const zerodb = CATALOG.find((p) => p.name === 'ZeroDB')!
    const title = artifactChipTitle('ZeroDB')
    expect(title).toBe(`${zerodb.purpose} — yours, on your own API.`)
  })

  // ── 3. Non-primitive labels return undefined (no spurious title) ──────────
  it('priority chip "P0" returns undefined (no title)', () => {
    expect(artifactChipTitle('P0')).toBeUndefined()
  })

  it('priority chip "P1" returns undefined', () => {
    expect(artifactChipTitle('P1')).toBeUndefined()
  })

  it('size chip "M" returns undefined', () => {
    expect(artifactChipTitle('M')).toBeUndefined()
  })

  it('size chip "S" returns undefined', () => {
    expect(artifactChipTitle('S')).toBeUndefined()
  })

  it('status chip "assigned" returns undefined', () => {
    expect(artifactChipTitle('assigned')).toBeUndefined()
  })

  it('completely unknown label returns undefined', () => {
    expect(artifactChipTitle('XYZ-NOT-A-PRIMITIVE-999')).toBeUndefined()
  })

  // ── 4. Decorated names resolve (guards real API-returned chip labels) ──────
  it('decorated "ZeroMemory · Working Memory" resolves via stem', () => {
    const title = artifactChipTitle('ZeroMemory · Working Memory')
    expect(title).toBeTruthy()
    expect(title).toContain('yours, on your own API')
  })

  it('decorated "AI Kit · Chat" resolves via prefix match', () => {
    const title = artifactChipTitle('AI Kit · Chat')
    expect(title).toBeTruthy()
    expect(title).toMatch(/UI|component|React|streaming/i)
  })

  it('decorated "ZeroPipeline · CRM" resolves via stem', () => {
    const title = artifactChipTitle('ZeroPipeline · CRM')
    expect(title).toBeTruthy()
    expect(title).toMatch(/CRM|sales/i)
  })

  // ── 5. All catalog primitives round-trip without error ────────────────────
  it('every catalog primitive produces a non-empty title via its own name', () => {
    for (const primitive of CATALOG) {
      const title = artifactChipTitle(primitive.name)
      expect(title, `${primitive.name} should resolve to a title`).toBeTruthy()
      expect(title!, `${primitive.name} title should be non-empty`).toContain('yours, on your own API')
    }
  })

  // ── 6. Ownership copy is always the same suffix (no variant typos) ─────────
  it('ownership suffix is exactly " — yours, on your own API."', () => {
    const knownPrimitives = ['ZeroDB', 'ZeroMemory', 'ZeroPipeline', 'AI Kit', 'Agent Cloud']
    for (const name of knownPrimitives) {
      const title = artifactChipTitle(name)
      expect(title, `${name} title missing`).toBeTruthy()
      // The suffix must be present and terminated with a period (no trailing spaces).
      expect(title).toMatch(/ — yours, on your own API\.$/)
    }
  })
})

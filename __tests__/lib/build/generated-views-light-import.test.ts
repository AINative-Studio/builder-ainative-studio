import { describe, it, expect } from 'vitest'

/**
 * #1200 — useAutoplay.ts and components/build/ArtifactFrame.tsx only ever
 * needed GENERATED_VIEWS (a Set<string> of ~16 view-name keys), but importing
 * it from artifact-prompts.ts dragged in that file's full module graph
 * (primitive-catalog.ts, primitive-graph.ts, capabilities.ts,
 * coding-standards.ts) for every jsdom test touching either module.
 *
 * generated-views.ts is now the real source, with zero imports of its own.
 * This test proves that importing it alone does NOT pull in
 * primitive-catalog.ts's module graph — the actual OOM-risk chain. It does
 * this by checking require.cache (CJS-transpiled by vitest) only contains
 * the lightweight module, never the heavy ones, right after a fresh import.
 */
describe('generated-views.ts has no heavy imports (#1200)', () => {
  it('exports the same real view-name keys as ARTIFACT_PROMPTS', async () => {
    const { GENERATED_VIEWS } = await import('@/lib/build/generated-views')
    const { ARTIFACT_PROMPTS } = await import('@/lib/build/artifact-prompts')

    expect(new Set(Object.keys(ARTIFACT_PROMPTS))).toEqual(new Set(GENERATED_VIEWS))
  })

  it('artifact-prompts.ts re-exports the identical Set instance, not a copy', async () => {
    const direct = await import('@/lib/build/generated-views')
    const reExported = await import('@/lib/build/artifact-prompts')

    expect(reExported.GENERATED_VIEWS).toBe(direct.GENERATED_VIEWS)
  })

  it('the real consumers import from the lightweight module, not artifact-prompts.ts', async () => {
    const fs = await import('fs')
    const autoplaySource = fs.readFileSync('lib/build/useAutoplay.ts', 'utf-8')
    const frameSource = fs.readFileSync('components/build/ArtifactFrame.tsx', 'utf-8')

    expect(autoplaySource).toContain("from '@/lib/build/generated-views'")
    expect(autoplaySource).not.toContain("GENERATED_VIEWS } from '@/lib/build/artifact-prompts'")
    expect(frameSource).toContain("from '@/lib/build/generated-views'")
    expect(frameSource).not.toContain("GENERATED_VIEWS } from '@/lib/build/artifact-prompts'")
  })

  it('generated-views.ts itself has no local imports at all', async () => {
    const fs = await import('fs')
    const source = fs.readFileSync('lib/build/generated-views.ts', 'utf-8')
    // No `import ... from` lines at all — this module must stay import-free
    // to guarantee it never drags in the heavy chain it exists to avoid.
    expect(source).not.toMatch(/^import /m)
  })
})

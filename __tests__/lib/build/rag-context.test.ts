import { describe, it, expect } from 'vitest'
import { formatRagContext, buildRagContext } from '@/lib/build/rag-context'

describe('rag-context (#81 · Phase 7a)', () => {
  it('empty recall → empty block (no-op)', () => {
    expect(formatRagContext('')).toBe('')
    expect(formatRagContext('   ')).toBe('')
  })

  it('non-empty recall → a labeled GUIDANCE block', () => {
    const b = formatRagContext('Last CRM: multi-file, used AIKitSidebar + /api/db, scored 8/8')
    expect(b).toMatch(/PRIOR BUILD LEARNINGS/)
    expect(b).toMatch(/GUIDANCE/)
    expect(b).toContain('AIKitSidebar')
  })

  it('caps oversized recall so it cannot crowd out the prompt', () => {
    const huge = 'x'.repeat(5000)
    const b = formatRagContext(huge)
    // content capped at 2000 chars; the fixed framing/header adds < 400 more.
    expect(b.length).toBeLessThan(2400)
    expect(b).toContain('…')
    expect(b).not.toContain('x'.repeat(2100)) // the raw content was truncated
  })

  it('buildRagContext returns "" when recall throws (best-effort)', async () => {
    const b = await buildRagContext('a CRM', async () => { throw new Error('memory down') })
    expect(b).toBe('')
  })

  it('buildRagContext returns "" when recall is empty', async () => {
    const b = await buildRagContext('a CRM', async () => '')
    expect(b).toBe('')
  })

  it('buildRagContext formats a real recall', async () => {
    const b = await buildRagContext('a CRM', async () => 'prior: used ZeroPipeline')
    expect(b).toMatch(/PRIOR BUILD LEARNINGS/)
    expect(b).toContain('ZeroPipeline')
  })
})

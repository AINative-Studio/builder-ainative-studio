import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real gap found live (issue #624, Meridian real-product build, 2026-09-10):
 * the general obedience-repair pass adopts a candidate if ANY dimension
 * improved (AIKit hand-rolling fixed, say) even when primitiveComplianceGaps
 * — the dimension that most defines whether a real product actually calls
 * its primitives — is still wide open. Confirmed live: a repair pass
 * correctly fixed a hand-rolled AIKitHeader but left "ZeroPipeline,
 * ZeroVoice, ZeroMemory never called" completely unresolved, and the
 * general check adopted it anyway.
 *
 * chat-ws now runs a SEPARATE, targeted retry loop (closePrimitiveComplianceGap)
 * after the general repair pass, whenever primitiveComplianceGaps is still
 * non-empty. The pure decision logic (narrowToPrimitiveComplianceOnly,
 * evaluatePrimitiveComplianceRetry) is unit-tested directly in
 * obedience-gate.test.ts; these tests confirm the wiring in chat-ws itself.
 */
describe('chat-ws wires the targeted primitive-compliance retry (2026-09-10, #624)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('imports the two new pure helpers from obedience-gate', () => {
    expect(source).toMatch(/narrowToPrimitiveComplianceOnly/)
    expect(source).toMatch(/evaluatePrimitiveComplianceRetry/)
  })

  it('defines closePrimitiveComplianceGap as a bounded retry loop (maxAttempts default 2)', () => {
    const idx = source.indexOf('async function closePrimitiveComplianceGap')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 400)
    expect(nearby).toMatch(/maxAttempts = 2/)
  })

  it('the non-combined obedience-repair branch calls closePrimitiveComplianceGap when the gap is still open after the general repair', () => {
    const idx = source.indexOf("console.log('📏 Obedience re-prompt improved the app — adopting.')")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 1200)
    expect(nearby).toMatch(/after\.primitiveComplianceGaps\.length > 0/)
    expect(nearby).toMatch(/closePrimitiveComplianceGap/)
  })

  it('the combined fix+split branch also calls it, but ONLY on the single-file adoption path (not the multi-file one, which would corrupt file markers)', () => {
    const singleFileIdx = source.indexOf("console.log('🔧 Combined pass fixed rules (single-file) — adopting.')")
    expect(singleFileIdx).toBeGreaterThan(-1)
    const nearbySingleFile = source.slice(singleFileIdx, singleFileIdx + 900)
    expect(nearbySingleFile).toMatch(/closePrimitiveComplianceGap/)

    const multiFileIdx = source.indexOf("console.log('🔧 Combined pass produced a valid multi-file, rule-following app — adopting.')")
    expect(multiFileIdx).toBeGreaterThan(-1)
    // Bounded to just this branch's own block — up to (not past) the next
    // adoption branch's console.log, so a match here can't accidentally pick
    // up the single-file branch's closePrimitiveComplianceGap call below it.
    const blockEnd = source.indexOf("console.log('🔧 Combined pass fixed rules (single-file) — adopting.')", multiFileIdx)
    const nearbyMultiFile = source.slice(multiFileIdx, blockEnd)
    // Deliberately NOT called here — see the scope-boundary comment in source.
    expect(nearbyMultiFile).not.toMatch(/closePrimitiveComplianceGap\(/)
  })
})

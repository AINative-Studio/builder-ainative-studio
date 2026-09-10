import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real gap found live (issue #624, Meridian real-product build, 2026-09-10):
 * the general obedience-repair pass adopts a candidate if ANY dimension
 * improved (AIKit hand-rolling fixed, say) even when primitiveComplianceGaps
 * — the dimension that most defines whether a real product actually calls
 * its primitives — is still wide open. Confirmed live TWICE: first via the
 * non-combined repair branch (a repair pass fixed a hand-rolled AIKitHeader
 * but left "ZeroPipeline, ZeroVoice, ZeroMemory never called" completely
 * unresolved), then via the combined fix+split branch's MULTI-FILE adoption
 * path (Meridian's real-product idea genuinely goes multi-file — "Multi-file
 * directive: ON" — and this branch was the one PR #625 originally scoped
 * OUT of the fix, since its single-file `\`\`\`jsx\`\`\`` repair prompt would
 * have corrupted real `// --- FILE:` structure; confirmed live this is
 * actually the MORE common path for a real product, not a rare edge case).
 *
 * chat-ws now runs a SEPARATE, targeted retry loop (closePrimitiveComplianceGap)
 * after the general repair pass, whenever primitiveComplianceGaps is still
 * non-empty — in BOTH single-file and multi-file adoption paths. It detects
 * the input's own shape and asks for the SAME shape back (marker format for
 * multi-file, `\`\`\`jsx\`\`\`` for single-file), rejecting a candidate that
 * collapses multi-file structure back to single-file. The pure decision
 * logic (narrowToPrimitiveComplianceOnly, evaluatePrimitiveComplianceRetry)
 * is unit-tested directly in obedience-gate.test.ts; these tests confirm the
 * wiring in chat-ws itself.
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
    const nearby = source.slice(idx, idx + 900)
    expect(nearby).toMatch(/maxAttempts = 2/)
  })

  it('detects multi-file input and asks for the SAME marker-format output back, not a single-file collapse', () => {
    const idx = source.indexOf('async function closePrimitiveComplianceGap')
    const nearby = source.slice(idx, idx + 6500)
    expect(nearby).toMatch(/isMultiFile\s*=\s*\/\\\/\\\/\\s\*---\\s\*FILE:\//)
    expect(nearby).toMatch(/FILE: src\/App\.tsx/)
    // Rejects a candidate that lost the multi-file structure — never
    // silently regresses real multi-file content to single-file.
    expect(nearby).toMatch(/lost the multi-file structure/)
  })

  it('the non-combined obedience-repair branch calls closePrimitiveComplianceGap when the gap is still open after the general repair', () => {
    const idx = source.indexOf("console.log('📏 Obedience re-prompt improved the app — adopting.')")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 1200)
    expect(nearby).toMatch(/after\.primitiveComplianceGaps\.length > 0/)
    expect(nearby).toMatch(/closePrimitiveComplianceGap/)
  })

  it('the combined fix+split branch calls it on BOTH adoption paths (single-file AND multi-file)', () => {
    const singleFileIdx = source.indexOf("console.log('🔧 Combined pass fixed rules (single-file) — adopting.')")
    expect(singleFileIdx).toBeGreaterThan(-1)
    const nearbySingleFile = source.slice(singleFileIdx, singleFileIdx + 900)
    expect(nearbySingleFile).toMatch(/closePrimitiveComplianceGap/)

    const multiFileIdx = source.indexOf("console.log('🔧 Combined pass produced a valid multi-file, rule-following app — adopting.')")
    expect(multiFileIdx).toBeGreaterThan(-1)
    const nearbyMultiFile = source.slice(multiFileIdx, multiFileIdx + 900)
    expect(nearbyMultiFile).toMatch(/closePrimitiveComplianceGap/)
  })

  /**
   * Durable tracing (#624 follow-up): live verification via `railway logs`
   * proved unreliable — the CLI showed no evidence the retry had run for a
   * real generation, even after the retry was confirmed correct by source
   * inspection and passing unit tests. Each call site now passes
   * responseId + a distinct branch label so a real verification can query
   * /api/build/primitive-compliance-trace instead of racing a log tail.
   */
  it('imports traceComplianceRetry and passes a distinct branch label + chatId at each of the 4 call sites', () => {
    expect(source).toMatch(/import \{ traceComplianceRetry \} from '@\/lib\/build\/primitive-compliance-trace'/)
    const calls = [...source.matchAll(/closePrimitiveComplianceGap\(\s*finalContent, message, validRole, obedienceOptions, selectedGenModel,\s*\n\s*responseId, '(non-combined|combined-single-file|combined-multi-file|combined-rejected-fallback)',/g)]
    const branches = calls.map((m) => m[1]).sort()
    expect(branches).toEqual(['combined-multi-file', 'combined-rejected-fallback', 'combined-single-file', 'non-combined'])
  })

  /**
   * Real bug found live (issue #636, 2026-09-10): the combined fix+split
   * branch has a THIRD outcome besides single-file/multi-file adoption —
   * rejection (the repair candidate was invalid, too short, or not an
   * improvement). That branch used to just log "Combined pass rejected —
   * keeping original." and stop, leaving finalContent at its PRE-repair
   * state — exactly the content `ob` already flagged as having primitive-
   * compliance gaps — with nothing ever retrying to close them. Confirmed
   * live: a real Meridian generation hit exactly this path (a catastrophic
   * syntax error in the combined-pass output caused rejection) and the
   * served app ended up with zero real primitive calls as a direct result.
   */
  it('the combined pass rejection fallback also runs the targeted retry on the pre-repair content', () => {
    const idx = source.indexOf("console.log('🔧 Combined pass rejected — keeping original.')")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 2000)
    expect(nearby).toMatch(/ob\.primitiveComplianceGaps\.length > 0/)
    expect(nearby).toMatch(/closePrimitiveComplianceGap/)
    expect(nearby).toMatch(/'combined-rejected-fallback'/)
  })

  it('closePrimitiveComplianceGap calls traceComplianceRetry on every exit path via a shared finish() wrapper', () => {
    const idx = source.indexOf('async function closePrimitiveComplianceGap')
    const nearby = source.slice(idx, idx + 4000)
    // finish() is async and AWAITS the trace write (2026-09-10 fix): the
    // earlier fire-and-forget version returned before traceComplianceRetry's
    // POST had finished, so a real generation's trace row was routinely lost
    // even though the retry itself ran and closed a real gap (confirmed live
    // against Meridian: retry adopted, ZeroDB generation row had the real
    // primitive calls, but the trace endpoint still came back empty).
    expect(nearby).toMatch(/const finish = async \(result:/)
    expect(nearby).toMatch(/await traceComplianceRetry\(\{/)
  })
})

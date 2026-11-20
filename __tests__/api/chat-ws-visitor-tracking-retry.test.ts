import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Issue #2135: the general obedience-repair pass in chat-ws gets exactly
 * ONE shot at closing visitorTrackingGap (and every other boolean gap)
 * before shipping — confirmed live across many independent samples this
 * isn't reliable enough on its own (roughly a quarter to a third of LANDING
 * PAGE/STORE TEASER generations shipped with zero `/api/db/visitors` call,
 * despite the gate correctly flagging every one of them). This mirrors
 * #624's fix for primitiveComplianceGaps exactly: chat-ws now runs a
 * SEPARATE, targeted retry loop (closeVisitorTrackingGap) after the general
 * repair pass, whenever visitorTrackingGap is still open — in every
 * adoption branch primitiveComplianceGaps already gets this for. The pure
 * decision logic (narrowToVisitorTrackingOnly, evaluateVisitorTrackingRetry)
 * is unit-tested directly in obedience-gate.test.ts; these tests confirm
 * the wiring in chat-ws itself.
 */
describe('chat-ws wires the targeted visitor-tracking retry (#2135)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('imports the two new pure helpers from obedience-gate', () => {
    expect(source).toMatch(/narrowToVisitorTrackingOnly/)
    expect(source).toMatch(/evaluateVisitorTrackingRetry/)
  })

  it('defines closeVisitorTrackingGap as a bounded retry loop (maxAttempts default 2)', () => {
    const idx = source.indexOf('async function closeVisitorTrackingGap')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 900)
    expect(nearby).toMatch(/maxAttempts = 2/)
  })

  it('detects multi-file input and asks for the SAME marker-format output back, not a single-file collapse', () => {
    const idx = source.indexOf('async function closeVisitorTrackingGap')
    const nearby = source.slice(idx, idx + 4000)
    expect(nearby).toMatch(/isMultiFile\s*=\s*hasRealFileMarker\(current\)/)
    expect(nearby).toMatch(/FILE: src\/App\.tsx/)
    expect(nearby).toMatch(/lost the multi-file structure/)
  })

  it('every call site passes a distinct branch label + chatId, matching the 5 branches closePrimitiveComplianceGap already covers', () => {
    const calls = [...source.matchAll(/closeVisitorTrackingGap\(\s*finalContent, message, validRole, obedienceOptions, selectedGenModel,\s*\n\s*responseId, '(non-combined|combined-single-file|combined-multi-file|combined-rejected-fallback|non-combined-repair-invalid-fallback)',/g)]
    const branches = calls.map((m) => m[1]).sort()
    expect(branches).toEqual([
      'combined-multi-file', 'combined-rejected-fallback', 'combined-single-file',
      'non-combined', 'non-combined-repair-invalid-fallback',
    ])
  })

  it('the combined fix+split branch calls it on BOTH adoption paths (single-file AND multi-file)', () => {
    const singleFileIdx = source.indexOf("console.log('🔧 Combined pass fixed rules (single-file) — adopting.')")
    expect(singleFileIdx).toBeGreaterThan(-1)
    const nearbySingleFile = source.slice(singleFileIdx, singleFileIdx + 1600)
    expect(nearbySingleFile).toMatch(/closeVisitorTrackingGap/)

    const multiFileIdx = source.indexOf("console.log('🔧 Combined pass produced a valid multi-file, rule-following app — adopting.')")
    expect(multiFileIdx).toBeGreaterThan(-1)
    const nearbyMultiFile = source.slice(multiFileIdx, multiFileIdx + 3000)
    expect(nearbyMultiFile).toMatch(/closeVisitorTrackingGap/)
  })

  it('the combined pass rejection fallback also runs the targeted retry on the pre-repair content', () => {
    const idx = source.indexOf("console.log('🔧 Combined pass rejected — keeping original.')")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 2500)
    expect(nearby).toMatch(/ob\.visitorTrackingGap/)
    expect(nearby).toMatch(/closeVisitorTrackingGap/)
    expect(nearby).toMatch(/'combined-rejected-fallback'/)
  })

  it('the non-combined obedience-repair branch calls closeVisitorTrackingGap when the gap is still open after the general repair', () => {
    const idx = source.indexOf("console.log('📏 Obedience re-prompt improved the app — adopting.')")
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 2200)
    expect(nearby).toMatch(/after\.visitorTrackingGap/)
    expect(nearby).toMatch(/closeVisitorTrackingGap/)
  })

  it('runs the targeted retry on the pre-repair content when the repair pass itself fails validation (non-combined branch), alongside the primitive-compliance fallback', () => {
    const idx = source.indexOf('const obValidation = validateGeneratedCode(obRaw)')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 6000)
    // The fallback condition now covers either gap, so BOTH closers get a
    // chance on this path, not just primitive compliance (#2135).
    expect(nearby).toMatch(/\}\s*else if \(ob\.primitiveComplianceGaps\.length > 0 \|\| ob\.visitorTrackingGap\)/)
    expect(nearby).toMatch(/closeVisitorTrackingGap/)
    expect(nearby).toMatch(/'non-combined-repair-invalid-fallback'/)
  })

  it('closeVisitorTrackingGap calls traceComplianceRetry on every exit path via a shared finish() wrapper, tagged with a visitor-tracking branch prefix', () => {
    const idx = source.indexOf('async function closeVisitorTrackingGap')
    const nearby = source.slice(idx, idx + 5000)
    expect(nearby).toMatch(/const finish = async \(result:/)
    expect(nearby).toMatch(/await traceComplianceRetry\(\{/)
    expect(nearby).toMatch(/`visitor-tracking:\$\{branch\}`/)
  })

  it('never adopts a failed-validation or shape-collapsed candidate — mirrors closePrimitiveComplianceGap\'s safety discipline', () => {
    const idx = source.indexOf('async function closeVisitorTrackingGap')
    const nearby = source.slice(idx, idx + 5000)
    expect(nearby).toMatch(/if \(!validated\.valid \|\| !validated\.code \|\| validated\.code\.length < 200\)/)
    expect(nearby).toMatch(/if \(isMultiFile && !hasRealFileMarker\(validated\.code\)\)/)
  })
})

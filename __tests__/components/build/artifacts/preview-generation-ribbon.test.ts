import { describe, it, expect } from 'vitest'
import { generationRibbonLine, stillGeneratingLine } from '@/components/build/artifacts/Preview'

/**
 * Real finding (#1255, live verification — two full builds, "Morphic" and
 * "Fluent"): the terminal ribbon's deploy narration (useAutoplay.ts's
 * RIBBON_LINES.preview) is a short, fully scripted sequence that always ends
 * on "deploy ▸ live at staging" and never advances again — even while the
 * real generation call (useRealPreview → /api/chat-ws) is still genuinely in
 * progress behind it. A founder watching the log cannot tell "almost done"
 * from "hung forever" during the single longest wait in the pipeline.
 *
 * generationRibbonLine and stillGeneratingLine are the pure decisions behind
 * the fix: keep narrating real backend activity (refreshKey, a genuine SSE
 * signal) for the real generation duration, and surface a distinct, honest
 * "still generating" state once the wait is long enough that silence alone
 * would read as stalled.
 */

describe('generationRibbonLine (pure)', () => {
  it('says nothing once generation is not in flight (ready/error/idle)', () => {
    expect(generationRibbonLine('ready', 3, 1, 10_000)).toBeNull()
    expect(generationRibbonLine('error', 3, 1, 10_000)).toBeNull()
    expect(generationRibbonLine('idle', 3, 1, 10_000)).toBeNull()
  })

  it('narrates a genuine refreshKey bump (real chat-ws files/refresh SSE event) while generating', () => {
    expect(generationRibbonLine('generating', 2, 1, 500)).toBe('generate ▸ writing app code…')
  })

  it('THE BUG scenario: no refreshKey movement yet, but not long enough for a heartbeat — says nothing (never fabricates fake progress)', () => {
    expect(generationRibbonLine('generating', 1, 1, 500, 4000)).toBeNull()
  })

  it('emits an honest heartbeat once the quiet stretch crosses the threshold, with no fake progress claim', () => {
    const line = generationRibbonLine('generating', 1, 1, 4000, 4000)
    expect(line).toBe('generate ▸ still working — this can take a few minutes')
  })

  it('a refreshKey bump takes priority over a stale heartbeat window', () => {
    expect(generationRibbonLine('generating', 5, 4, 9000, 4000)).toBe('generate ▸ writing app code…')
  })
})

describe('stillGeneratingLine (pure)', () => {
  it('says nothing before the threshold — the plain "building…" line is still accurate alone', () => {
    expect(stillGeneratingLine(0)).toBeNull()
    expect(stillGeneratingLine(14_999, 15_000)).toBeNull()
  })

  it('THE FIX: once the wait crosses the threshold, surfaces a distinct honest "still generating" state', () => {
    expect(stillGeneratingLine(15_000, 15_000)).toBe(
      'Still generating your app — this can take several minutes for a complex build.',
    )
    expect(stillGeneratingLine(120_000, 15_000)).toMatch(/still generating/i)
  })

  it('respects a custom threshold', () => {
    expect(stillGeneratingLine(5_000, 10_000)).toBeNull()
    expect(stillGeneratingLine(10_000, 10_000)).not.toBeNull()
  })
})

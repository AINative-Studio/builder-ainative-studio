import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real bug found live (Meridian, https://builder.ainative.studio/build/meridian,
 * 2026-09-10): the obedience-gate repair pass in chat-ws (the "improve this
 * app to follow AINative rules" re-prompt) truncated the CURRENT APP shown
 * back to the model to 12000 characters. Real generations routinely run
 * 25k-32k chars (confirmed via production logs: 25517, 27477, 28189, 29228,
 * 31982 chars across several real requests) — well over double that cap.
 * Told to "keep every feature" while unable to see the back half of its own
 * code (including, in the reported failures, wherever ./ui/button|input|
 * badge/card/separator were originally imported), the model re-referenced
 * components it could no longer see the real import for, producing exactly
 * the "imported local module(s) never defined" truncation this gate is
 * supposed to catch, not cause. Reproduced 4/4 times in a row on real
 * production requests, all failing identically on the same missing-import
 * signature.
 */
describe('chat-ws obedience repair pass does not truncate real-sized generations (2026-09-10)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('the CURRENT APP slice sent to the general obedience repair pass is at least 32000 chars, not the old 12000', () => {
    // Real chat-ws.ts now has TWO "CURRENT APP:" occurrences — the general
    // repair pass (finalContent.slice) and the #624 targeted primitive-
    // compliance retry (current.slice, tested separately below). Anchor on
    // the specific variable this test is actually about.
    const idx = source.indexOf('${finalContent.slice(0, 32000)}')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx - 50, idx + 50)
    expect(nearby).toMatch(/finalContent\.slice\(0, 32000\)/)
    expect(source).not.toMatch(/finalContent\.slice\(0, 12000\)/)
  })

  /**
   * #624's targeted primitive-compliance retry re-sends the CURRENT APP to
   * the model too (a real generation is 25k-32k chars, same as the general
   * repair pass) — it must not reintroduce the exact same undersized-cap
   * bug this file's other test already fixed once.
   */
  it('the #624 targeted primitive-compliance retry also uses the full 32000-char cap, not a smaller one', () => {
    const idx = source.indexOf('${current.slice(0, 32000)}')
    expect(idx).toBeGreaterThan(-1)
  })
})

describe('decomposition prompts do not truncate real-sized generations (2026-09-10)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib/build/decomposition.ts'), 'utf8')

  it('both prompt builders cap at 32000 chars, not the old 16000', () => {
    const matches = [...source.matchAll(/singleFileCode\.slice\(0, (\d+)\)/g)]
    expect(matches.length).toBeGreaterThanOrEqual(2)
    for (const m of matches) {
      expect(Number(m[1])).toBe(32000)
    }
  })
})

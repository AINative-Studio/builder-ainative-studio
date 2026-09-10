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

  it('the CURRENT APP slice sent to the obedience repair pass is at least 32000 chars, not the old 12000', () => {
    const idx = source.indexOf('CURRENT APP:')
    expect(idx).toBeGreaterThan(-1)
    const nearby = source.slice(idx, idx + 200)
    expect(nearby).toMatch(/finalContent\.slice\(0, 32000\)/)
    expect(nearby).not.toMatch(/finalContent\.slice\(0, 12000\)/)
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

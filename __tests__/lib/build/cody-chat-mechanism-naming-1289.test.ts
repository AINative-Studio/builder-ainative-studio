import { readFileSync } from 'fs'
import { join } from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #1289 (Fix 2) — SUMMARY_SYSTEM_PROMPT and EXPLAIN_SYSTEM_PROMPT ban founder-
 * facing jargon ("swarm", "provision", etc.) for a non-technical audience —
 * that ban is deliberate and must stay exactly as-is. The real gap: with only
 * a ban and no positive guidance, the model defaults to totally generic copy
 * ("working on it") instead of naming the real mechanism in plain language
 * (e.g. "I'm having our research specialist pull real data").
 *
 * This is a prompt-text change, not new code logic, so the test reads the
 * actual prompt source strings (same pattern as cody-chat-call-timeout-1266
 * for this file) and asserts:
 *   1. The banned-word list is unchanged (still bans the exact jargon words).
 *   2. Each prompt now explicitly instructs plain-language mechanism naming,
 *      with a concrete allowed-vs-banned example so the instruction is
 *      unambiguous to the model.
 */
describe('cody-chat.ts system prompts encourage plain-language mechanism naming (#1289)', () => {
  const source = readFileSync(join(process.cwd(), 'lib/build/cody-chat.ts'), 'utf8')

  it('keeps the exact banned-jargon word list in SUMMARY_SYSTEM_PROMPT unchanged', () => {
    const match = source.match(/const SUMMARY_SYSTEM_PROMPT = `([\s\S]*?)`/)
    expect(match).toBeTruthy()
    const prompt = match![1]
    for (const word of ['wedge', 'PRD', 'data model', 'memory policy', 'AI-native', 'swarm', 'provision']) {
      expect(prompt).toContain(`"${word}"`)
    }
  })

  it('SUMMARY_SYSTEM_PROMPT encourages naming the real mechanism in plain language', () => {
    const match = source.match(/const SUMMARY_SYSTEM_PROMPT = `([\s\S]*?)`/)
    const prompt = match![1]
    // Must not just ban jargon — must positively ask for plain-language
    // mechanism naming, with a concrete example contrasting allowed vs banned
    // phrasing, so the model stops defaulting to "working on it".
    expect(prompt.toLowerCase()).toMatch(/plain[- ]language|name (the|what)|be concrete/i)
    expect(prompt).toMatch(/research specialist/i)
    // "working on it" may appear only as a named example of the generic
    // filler to AVOID, never as a standalone instruction to use it.
    const genericFillerIdx = prompt.toLowerCase().indexOf('working on it')
    expect(genericFillerIdx).toBeGreaterThan(-1)
    const surrounding = prompt.slice(Math.max(0, genericFillerIdx - 40), genericFillerIdx + 40).toLowerCase()
    expect(surrounding).toMatch(/generic|filler|avoid|instead|rather than/)
  })

  it('keeps the EXPLAIN_SYSTEM_PROMPT jargon-free rule and adds mechanism-naming guidance', () => {
    const match = source.match(/const EXPLAIN_SYSTEM_PROMPT = `([\s\S]*?)`/)
    expect(match).toBeTruthy()
    const prompt = match![1]
    expect(prompt).toMatch(/no jargon/i)
    expect(prompt.toLowerCase()).toMatch(/plain[- ]language|name (the|what)|be concrete/i)
  })

  it('both prompts give a concrete banned-vs-allowed phrasing example (dispatching our swarm vs research specialist)', () => {
    const summaryMatch = source.match(/const SUMMARY_SYSTEM_PROMPT = `([\s\S]*?)`/)
    const explainMatch = source.match(/const EXPLAIN_SYSTEM_PROMPT = `([\s\S]*?)`/)
    const summaryPrompt = summaryMatch![1]
    const explainPrompt = explainMatch![1]
    // At least one of the two prompts must spell out the concrete contrast
    // from the issue: generic ("working on it") and banned-jargon ("dispatching
    // our swarm") vs the encouraged plain-mechanism phrasing.
    const combined = summaryPrompt + '\n' + explainPrompt
    expect(combined).toMatch(/dispatching our swarm/i)
    expect(combined).toMatch(/research specialist/i)
  })
})

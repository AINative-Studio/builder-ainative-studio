import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real bug, found live (2026-11-04, issue #1812): two consecutive real
 * e-commerce product generations ("Hearthglow", "Rivercraft") both had
 * their fallback-model retry fail with "403 status code (no body)" on
 * ministral-14b specifically — confirmed as a RECURRING pattern across
 * three separate Railway log captures this session, not a one-off
 * transient failure.
 *
 * executeChunkPlanWithBudget's retry (added in #1805/#1808) only ever uses
 * `fallbackModels[0]` — a single retry per failed phase, not a full
 * rotation through every fallback. When STANDARD_FALLBACKS's FIRST entry
 * is the one persistently-broken model, the entire fallback mechanism this
 * session shipped is silently defeated: every fallback retry tries the one
 * model guaranteed to fail.
 *
 * Confirmed live: Rivercraft's Phases 1-4 all succeeded cleanly (the
 * context-size fix in #1811 working correctly), but Phase 5 and 6 both
 * failed their fallback retry with the same ministral-14b 403 — 4/6 chunks
 * merged instead of 6/6.
 *
 * Notably, this exact file's OWN runValidationRetryLoop call site (the
 * repair-loop model rotation, a sibling fallback mechanism) already puts
 * ministral-14b LAST: `['qwen-coder-32b', 'gpt-oss-20b', 'ministral-14b']`.
 * STANDARD_FALLBACKS instead put it FIRST — an inconsistent ordering this
 * fix resolves by aligning STANDARD_FALLBACKS with the already-proven-safer
 * order, rather than introducing a third, different ordering.
 */
describe('chat-ws STANDARD_FALLBACKS model order (2026-11-04, #1812)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../app/api/chat-ws/route.ts'),
    'utf-8',
  )

  it('does not put ministral-14b first in STANDARD_FALLBACKS — it has a recurring live 403 failure', () => {
    const m = source.match(/const STANDARD_FALLBACKS = \[([^\]]+)\]/)
    expect(m, 'STANDARD_FALLBACKS definition not found').toBeTruthy()
    const models = m![1].split(',').map((s) => s.trim().replace(/['"]/g, ''))
    expect(models[0]).not.toBe('ministral-14b')
    expect(models).toContain('qwen-coder-32b')
  })

  it('keeps STANDARD_FALLBACKS in the same order as the proven-safe repair-loop rotation (qwen-coder-32b, gpt-oss-20b, ministral-14b)', () => {
    const m = source.match(/const STANDARD_FALLBACKS = \[([^\]]+)\]/)
    const models = m![1].split(',').map((s) => s.trim().replace(/['"]/g, ''))
    expect(models).toEqual(['qwen-coder-32b', 'gpt-oss-20b', 'ministral-14b'])
  })
})

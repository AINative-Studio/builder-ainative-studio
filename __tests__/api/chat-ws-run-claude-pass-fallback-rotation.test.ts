import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

/**
 * Real bug, found live (2026-11-04, issue #1819): a real "Saltmarsh"
 * e-commerce generation shipped with its ZeroCommerce primitive-compliance
 * gap still open ("🚨 SHIPPING with unclosed primitive-compliance gap(s):
 * ZeroCommerce...") specifically because EVERY primitive-compliance repair
 * attempt via runClaudePass() hit its single hardcoded AINative fallback —
 * `process.env.DEFAULT_MODEL || 'qwen-coder-32b'` — while that model was
 * returning "503 status code (no body)" on every call. Same incident class
 * as #1813 (lib/agent/multi-pass-generator.ts's generateChunk, a SEPARATE
 * code path this function doesn't share), fixed the same way: rotate
 * through STANDARD_FALLBACKS instead of a single hardcoded model, so one
 * model's outage can no longer defeat the obedience-repair / primitive-
 * compliance retry loop on its own.
 *
 * Source-text assertion, not a module-execution test — same established
 * precedent as chat-ws-run-claude-pass-timeout.test.ts (this module eagerly
 * instantiates real OpenAI/Bedrock clients at import time).
 */

const routeSource = readFileSync(
  join(process.cwd(), 'app/api/chat-ws/route.ts'),
  'utf-8',
)

function extractFunctionBody(source: string, marker: string, maxLen = 4200): string {
  const idx = source.indexOf(marker)
  expect(idx, `${marker} not found in source`).toBeGreaterThan(-1)
  return source.slice(idx, idx + maxLen)
}

describe('runClaudePass() AINative fallback rotates through STANDARD_FALLBACKS (2026-11-04, #1819)', () => {
  it('does not hardcode a single fallback model — iterates a list instead', () => {
    const body = extractFunctionBody(routeSource, 'async function runClaudePass(')
    // The real bug: a single `model: process.env.DEFAULT_MODEL || 'qwen-coder-32b'`
    // with no loop around it.
    expect(body).not.toMatch(/model:\s*process\.env\.DEFAULT_MODEL\s*\|\|\s*'qwen-coder-32b',\s*\n\s*max_tokens/)
    expect(body).toMatch(/for\s*\(const fallbackModel of/)
  })

  it('builds its fallback candidate list from STANDARD_FALLBACKS, not a hardcoded single model', () => {
    const body = extractFunctionBody(routeSource, 'async function runClaudePass(')
    expect(body).toMatch(/\.\.\.STANDARD_FALLBACKS/)
  })

  it('keeps trying on a per-model failure (catches and continues) instead of giving up after the first fallback model', () => {
    const body = extractFunctionBody(routeSource, 'async function runClaudePass(')
    const forIdx = body.indexOf('for (const fallbackModel of')
    expect(forIdx).toBeGreaterThan(-1)
    const loopBody = body.slice(forIdx, forIdx + 1500)
    expect(loopBody).toMatch(/catch\s*\(err[^)]*\)\s*\{/)
    expect(loopBody).toContain('AINative fallback')
    // The catch block's OWN body (just its console.warn, up to its closing
    // brace) must not itself return/throw — that would stop the loop after
    // just one failed fallback model. (The function DOES `return ''` after
    // the loop exits naturally once every model has been tried — that's
    // correct and expected, just not reachable from inside this catch.)
    const catchIdx = loopBody.search(/catch\s*\(err[^)]*\)\s*\{/)
    const catchOpenIdx = loopBody.indexOf('{', catchIdx)
    const catchCloseIdx = loopBody.indexOf('\n    }', catchOpenIdx)
    const catchBody = loopBody.slice(catchOpenIdx, catchCloseIdx)
    expect(catchBody).not.toMatch(/return /)
    expect(catchBody).not.toMatch(/throw /)
  })

  it('still returns the real content on the FIRST successful fallback (does not keep trying more models than needed)', () => {
    const body = extractFunctionBody(routeSource, 'async function runClaudePass(')
    const forIdx = body.indexOf('for (const fallbackModel of')
    const loopBody = body.slice(forIdx, forIdx + 1500)
    expect(loopBody).toMatch(/return res\.choices\?\.\[0\]\?\.message\?\.content \|\| ''/)
  })

  it('deduplicates DEFAULT_MODEL against STANDARD_FALLBACKS so the same model is never tried twice', () => {
    const body = extractFunctionBody(routeSource, 'async function runClaudePass(')
    expect(body).toMatch(/arr\.indexOf\(m\) === i/)
  })
})

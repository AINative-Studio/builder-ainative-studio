import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Real design gap, found live (2026-11-04, issue #1832), superseding the
 * earlier #1812 fix this file used to cover (STANDARD_FALLBACKS's model
 * ORDER): the whole chain was wrong-TIER, not just wrong-order.
 * qwen-coder-32b/gpt-oss-20b/ministral-14b are all free/"basic" tier,
 * single-provider (NIM-only) models by deliberate design on core's side —
 * verified directly against core's model_registry.py, not guessed.
 * Builder's founders are paid/enterprise accounts; a generation falling
 * back onto free-tier, single-provider models when Bedrock is rate-limited
 * is the wrong tier entirely, not just a reliability gap. Confirmed live:
 * both ministral-14b (403) and qwen-coder-32b (503) had a multi-hour
 * window of near-100% failure the same night (#1818/core#9948), leaving
 * Builder's entire post-Bedrock fallback chain with nothing to fall
 * through to — because every entry in it shared the same single-provider
 * fragility.
 *
 * Fixed by replacing the whole chain with core's real DigitalOcean-backed,
 * PAID ("pro") coding fallback — 'qwen3-coder-flash' (DO-only, core's
 * "DigitalOcean serverless coding models (pro+)" section) and 'kimi-k2'
 * (paid, dual-provider NIM+DO) — so an enterprise generation stays on the
 * paid tier end-to-end: Bedrock (primary) -> DigitalOcean-backed paid
 * coding model (fallback), never free/basic tier.
 */
describe('chat-ws fallback model chain stays on paid/enterprise tier, DigitalOcean-backed (2026-11-04, #1832)', () => {
  const source = fs.readFileSync(
    path.join(__dirname, '../../app/api/chat-ws/route.ts'),
    'utf-8',
  )

  function extractList(constName: string): string[] {
    const m = source.match(new RegExp(`const ${constName} = \\[([^\\]]+)\\]`))
    expect(m, `${constName} definition not found`).toBeTruthy()
    return m![1].split(',').map((s) => s.trim().replace(/['"]/g, '')).filter(Boolean)
  }

  it('STANDARD_FALLBACKS contains the real DigitalOcean-backed paid coding model, qwen3-coder-flash', () => {
    const models = extractList('STANDARD_FALLBACKS')
    expect(models).toContain('qwen3-coder-flash')
  })

  it('STANDARD_FALLBACKS no longer contains any free/basic-tier, single-provider model', () => {
    const models = extractList('STANDARD_FALLBACKS')
    // qwen-coder-32b, gpt-oss-20b, ministral-14b are all free/"basic" tier,
    // NIM-only in core's registry — none belong in an enterprise fallback
    // chain.
    expect(models).not.toContain('qwen-coder-32b')
    expect(models).not.toContain('gpt-oss-20b')
    expect(models).not.toContain('ministral-14b')
  })

  it('PREMIUM_FALLBACKS also stays on the DigitalOcean-backed paid chain, not the old free-tier models', () => {
    const models = extractList('PREMIUM_FALLBACKS')
    expect(models).toContain('qwen3-coder-flash')
    expect(models).not.toContain('qwen-coder-32b')
    expect(models).not.toContain('ministral-14b')
  })

  it('qwen3-coder-flash is registered in MODEL_CONFIG so it actually routes correctly', () => {
    expect(source).toMatch(/'qwen3-coder-flash':\s*\{\s*provider:\s*'ainative',\s*modelId:\s*'qwen3-coder-flash'/)
  })
})

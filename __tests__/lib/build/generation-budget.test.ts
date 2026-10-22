import { describe, it, expect, afterEach } from 'vitest'
import {
  MODEL_PRICING,
  DEFAULT_PRICING_KEY,
  pricingForModel,
  costForUsage,
  resolveBudgetUsd,
  budgetForTier,
  DEFAULT_GENERATION_BUDGET_USD,
  createGenerationBudget,
  recordCall,
  canAffordAnotherCall,
  checkBudget,
  budgetStopMessage,
  type GenerationBudget,
} from '@/lib/build/generation-budget'

describe('generation-budget (#1192 — per-generation token/cost budget)', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
  })

  // ── Real per-model pricing ────────────────────────────────────────────────
  describe('pricingForModel', () => {
    it('prices Claude Sonnet 4.5 at the rates route.ts already hardcodes ($3/$15 per 1M)', () => {
      // route.ts line ~1263: input * 0.000003 + output * 0.000015 — i.e. $3/$15 per 1M.
      const p = pricingForModel('claude-sonnet-4-5-20250929')
      expect(p.inputPerMillionUsd).toBe(3)
      expect(p.outputPerMillionUsd).toBe(15)
    })

    it('prices Opus HIGHER than Sonnet — the bug this fixes is every model billed at Sonnet rates', () => {
      const opus = pricingForModel('claude-opus-4-5-20251101')
      const sonnet = pricingForModel('claude-sonnet-4-5-20250929')
      expect(opus.outputPerMillionUsd).toBeGreaterThan(sonnet.outputPerMillionUsd)
    })

    it('prices Haiku LOWER than Sonnet (the Starter-tier generation model)', () => {
      const haiku = pricingForModel('claude-haiku-4-5-20251001')
      const sonnet = pricingForModel('claude-sonnet-4-5-20250929')
      expect(haiku.outputPerMillionUsd).toBeLessThan(sonnet.outputPerMillionUsd)
    })

    it('matches on model-family substring, so a bare Bedrock/region-prefixed ID still prices correctly', () => {
      // Bedrock IDs arrive as e.g. 'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
      const bedrock = pricingForModel('us.anthropic.claude-sonnet-4-5-20250929-v1:0')
      expect(bedrock.inputPerMillionUsd).toBe(3)
      expect(bedrock.outputPerMillionUsd).toBe(15)
    })

    it('falls back to the documented default for an unknown model rather than pricing it free', () => {
      const unknown = pricingForModel('some-model-nobody-has-heard-of')
      expect(unknown).toEqual(MODEL_PRICING[DEFAULT_PRICING_KEY])
      // Pricing an unknown model at $0 would make the cap unenforceable.
      expect(unknown.outputPerMillionUsd).toBeGreaterThan(0)
    })

    it('never returns undefined, even for an empty/garbage model id', () => {
      expect(pricingForModel('')).toBeDefined()
      expect(pricingForModel(undefined as unknown as string)).toBeDefined()
    })
  })

  describe('costForUsage', () => {
    it('computes the same dollar figure route.ts computes today for Sonnet', () => {
      // route.ts: (1000 * 0.000003) + (2000 * 0.000015) = 0.003 + 0.030 = 0.033
      expect(costForUsage(1000, 2000, 'claude-sonnet-4-5-20250929')).toBeCloseTo(0.033, 10)
    })

    it('returns 0 for zero usage', () => {
      expect(costForUsage(0, 0, 'claude-sonnet-4-5-20250929')).toBe(0)
    })

    it('treats negative/NaN token counts as 0 rather than crediting the budget back', () => {
      expect(costForUsage(-5000, -5000, 'claude-sonnet-4-5-20250929')).toBe(0)
      expect(costForUsage(NaN, NaN, 'claude-sonnet-4-5-20250929')).toBe(0)
    })
  })

  // ── Configurable limit ────────────────────────────────────────────────────
  describe('resolveBudgetUsd — configuration', () => {
    it('defaults to DEFAULT_GENERATION_BUDGET_USD when nothing is configured', () => {
      delete process.env.GENERATION_BUDGET_USD
      expect(resolveBudgetUsd()).toBe(DEFAULT_GENERATION_BUDGET_USD)
    })

    it('honours the GENERATION_BUDGET_USD env var', () => {
      process.env.GENERATION_BUDGET_USD = '0.25'
      expect(resolveBudgetUsd()).toBe(0.25)
    })

    it('ignores a non-numeric env var rather than producing NaN (which would disable the cap)', () => {
      process.env.GENERATION_BUDGET_USD = 'not-a-number'
      expect(resolveBudgetUsd()).toBe(DEFAULT_GENERATION_BUDGET_USD)
    })

    it('ignores a zero/negative env var — a 0 cap would stop every generation before it started', () => {
      process.env.GENERATION_BUDGET_USD = '0'
      expect(resolveBudgetUsd()).toBe(DEFAULT_GENERATION_BUDGET_USD)
      process.env.GENERATION_BUDGET_USD = '-3'
      expect(resolveBudgetUsd()).toBe(DEFAULT_GENERATION_BUDGET_USD)
    })

    it('resolves a per-tier budget, with paid tiers allowed more than free', () => {
      delete process.env.GENERATION_BUDGET_USD
      const free = budgetForTier('hobbyist')
      const starter = budgetForTier('starter')
      const pro = budgetForTier('pro')
      expect(starter).toBeGreaterThan(free)
      expect(pro).toBeGreaterThan(starter)
    })

    it('maps an unknown tier to the free allowance (never the most generous one)', () => {
      delete process.env.GENERATION_BUDGET_USD
      expect(budgetForTier('some-unknown-plan')).toBe(budgetForTier('hobbyist'))
    })

    it('lets an explicit env override win over the tier table (operator escape hatch)', () => {
      process.env.GENERATION_BUDGET_USD = '9.5'
      expect(budgetForTier('hobbyist')).toBe(9.5)
      expect(budgetForTier('pro')).toBe(9.5)
    })
  })

  // ── Accumulation across the calls of ONE generation ───────────────────────
  describe('accumulation across multiple LLM calls in one generation', () => {
    it('starts at zero spend with the configured limit', () => {
      const b = createGenerationBudget({ limitUsd: 1.0, model: 'claude-sonnet-4-5-20250929' })
      expect(b.spentUsd).toBe(0)
      expect(b.calls).toBe(0)
      expect(b.limitUsd).toBe(1.0)
      expect(b.stopped).toBe(false)
    })

    it('accumulates cost ACROSS calls — the gap #1192 is about', () => {
      let b = createGenerationBudget({ limitUsd: 10, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 1000, outputTokens: 2000 })
      expect(b.spentUsd).toBeCloseTo(0.033, 10)
      b = recordCall(b, { inputTokens: 1000, outputTokens: 2000 })
      expect(b.spentUsd).toBeCloseTo(0.066, 10)
      b = recordCall(b, { inputTokens: 1000, outputTokens: 2000 })
      expect(b.spentUsd).toBeCloseTo(0.099, 10)
      expect(b.calls).toBe(3)
      expect(b.totalInputTokens).toBe(3000)
      expect(b.totalOutputTokens).toBe(6000)
      expect(b.totalTokens).toBe(9000)
    })

    it('prices a per-call model override independently (fallback paths switch models mid-generation)', () => {
      let b = createGenerationBudget({ limitUsd: 10, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 1_000_000, outputTokens: 0 }) // $3 at Sonnet
      b = recordCall(b, { inputTokens: 1_000_000, outputTokens: 0, model: 'claude-haiku-4-5-20251001' })
      // Haiku input is cheaper than Sonnet's $3/M, so total must be < $6.
      expect(b.spentUsd).toBeGreaterThan(3)
      expect(b.spentUsd).toBeLessThan(6)
    })

    it('is immutable — recordCall returns a new budget rather than mutating the old one', () => {
      const b0 = createGenerationBudget({ limitUsd: 10, model: 'claude-sonnet-4-5-20250929' })
      const b1 = recordCall(b0, { inputTokens: 1000, outputTokens: 2000 })
      expect(b0.spentUsd).toBe(0)
      expect(b1).not.toBe(b0)
    })
  })

  // ── Stopping BEFORE the cap is exceeded (the acceptance criterion) ────────
  describe('stopping BEFORE the limit is exceeded', () => {
    it('allows a call that comfortably fits', () => {
      const b = createGenerationBudget({ limitUsd: 1.0, model: 'claude-sonnet-4-5-20250929' })
      const decision = canAffordAnotherCall(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 })
      expect(decision.allowed).toBe(true)
    })

    it('refuses the NEXT call when its worst case would cross the cap — pre-flight, not post-hoc', () => {
      // One 16k-output Sonnet call costs at worst 16000*15/1e6 = $0.24 output
      // + 4000*3/1e6 = $0.012 input = $0.252. A $0.30 cap with $0.20 already
      // spent cannot afford it, even though $0.20 < $0.30.
      let b = createGenerationBudget({ limitUsd: 0.30, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 0, outputTokens: 13_333 }) // ≈ $0.20
      expect(b.spentUsd).toBeLessThan(b.limitUsd) // under the cap...
      const decision = canAffordAnotherCall(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 })
      expect(decision.allowed).toBe(false) // ...but the next call would blow it
      expect(decision.reason).toBe('would_exceed_budget')
      expect(decision.projectedUsd).toBeGreaterThan(b.limitUsd)
    })

    it('refuses once the cap is already reached', () => {
      let b = createGenerationBudget({ limitUsd: 0.05, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 1000, outputTokens: 4000 }) // 0.003 + 0.060 = $0.063
      expect(b.spentUsd).toBeGreaterThan(b.limitUsd)
      expect(canAffordAnotherCall(b).allowed).toBe(false)
    })

    it('ALWAYS allows the first call, even when one worst-case call exceeds the whole cap', () => {
      // A misconfigured tiny cap must never produce a generation that did nothing
      // at all — the founder would see an error with no app and no explanation.
      const b = createGenerationBudget({ limitUsd: 0.000001, model: 'claude-sonnet-4-5-20250929' })
      const decision = canAffordAnotherCall(b, { maxOutputTokens: 16000 })
      expect(decision.allowed).toBe(true)
      expect(decision.reason).toBe('first_call')
    })

    it('marks the budget stopped once a call is refused, and reports why', () => {
      let b = createGenerationBudget({ limitUsd: 0.05, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 1000, outputTokens: 4000 })
      const result = checkBudget(b, { maxOutputTokens: 16000 })
      expect(result.budget.stopped).toBe(true)
      expect(result.budget.stopReason).toBe('exceeded_budget')
      expect(result.allowed).toBe(false)
    })

    it('stays stopped on every subsequent check (no flapping back open)', () => {
      let b = createGenerationBudget({ limitUsd: 0.05, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 1000, outputTokens: 4000 })
      b = checkBudget(b, { maxOutputTokens: 16000 }).budget
      expect(b.stopped).toBe(true)
      const again = checkBudget(b, { maxOutputTokens: 16000 })
      expect(again.allowed).toBe(false)
      expect(again.budget.stopped).toBe(true)
    })
  })

  // ── The real runaway scenario this issue describes ────────────────────────
  describe('runaway multi-phase generation (the real lib/agent/multi-pass-generator loop)', () => {
    /**
     * executeChunkPlan() runs N phases sequentially at max_tokens 16000 each,
     * plus ONE RETRY per failed phase — up to 2N real LLM calls with no spend
     * check between them. This simulates that loop under a real cap and asserts
     * it stops partway instead of running every phase.
     */
    it('stops a 10-phase loop partway instead of billing all 10 phases', () => {
      let b = createGenerationBudget({ limitUsd: 0.50, model: 'claude-sonnet-4-5-20250929' })
      const executed: number[] = []

      for (let phase = 1; phase <= 10; phase++) {
        const decision = canAffordAnotherCall(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 })
        if (!decision.allowed) {
          b = checkBudget(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 }).budget
          break
        }
        executed.push(phase)
        // Each phase really does use its full 16k output budget on a rich build.
        b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 })
      }

      expect(b.stopped).toBe(true)
      expect(executed.length).toBeGreaterThan(0)       // it did real work
      expect(executed.length).toBeLessThan(10)         // but not all 10 phases
      expect(b.spentUsd).toBeLessThanOrEqual(b.limitUsd) // and never blew the cap
    })

    it('never exceeds the configured cap no matter how many phases are requested', () => {
      const limitUsd = 0.40
      let b = createGenerationBudget({ limitUsd, model: 'claude-sonnet-4-5-20250929' })
      for (let phase = 1; phase <= 100; phase++) {
        if (!canAffordAnotherCall(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 }).allowed) break
        b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 })
      }
      expect(b.spentUsd).toBeLessThanOrEqual(limitUsd)
      expect(b.calls).toBeLessThan(100)
    })

    it('counts a phase RETRY against the same generation budget', () => {
      let b = createGenerationBudget({ limitUsd: 10, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 }) // phase 1 attempt
      const afterFirst = b.spentUsd
      b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 }) // phase 1 RETRY
      expect(b.spentUsd).toBeCloseTo(afterFirst * 2, 10)
      expect(b.calls).toBe(2)
    })
  })

  // ── The honest, structured stop message ──────────────────────────────────
  describe('budgetStopMessage — a real structured response, not a silent truncation', () => {
    it('reports the real spend, the real limit and the real call count', () => {
      let b = createGenerationBudget({ limitUsd: 0.50, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 })
      b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 })
      b = checkBudget(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 }).budget

      const msg = budgetStopMessage(b)
      expect(msg.type).toBe('budget_exceeded')
      expect(msg.limitUsd).toBe(0.50)
      expect(msg.spentUsd).toBeCloseTo(b.spentUsd, 10)
      expect(msg.calls).toBe(2)
      expect(msg.totalTokens).toBe(b.totalTokens)
      expect(msg.message).toMatch(/cost limit/i)
      // Honest: the real numbers appear in the human-readable text.
      expect(msg.message).toContain('0.50')
    })

    it('says generation stopped — never implies the app finished normally', () => {
      let b = createGenerationBudget({ limitUsd: 0.05, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 1000, outputTokens: 4000 })
      b = checkBudget(b).budget
      expect(budgetStopMessage(b).message.toLowerCase()).toContain('stopped')
    })

    it('reports partial-progress truthfully so the UI can offer what WAS built', () => {
      let b = createGenerationBudget({ limitUsd: 0.30, model: 'claude-sonnet-4-5-20250929' })
      b = recordCall(b, { inputTokens: 4000, outputTokens: 16000 })
      b = checkBudget(b, { maxOutputTokens: 16000, estimatedInputTokens: 4000 }).budget
      const msg = budgetStopMessage(b)
      expect(msg.partial).toBe(true) // at least one call succeeded
    })
  })

  // ── It must never break the most important path in the app ───────────────
  describe('fail-safety', () => {
    it('tolerates a usage object with missing fields (providers omit usage on stream errors)', () => {
      let b = createGenerationBudget({ limitUsd: 1, model: 'claude-sonnet-4-5-20250929' })
      expect(() => { b = recordCall(b, {} as any) }).not.toThrow()
      expect(b.spentUsd).toBe(0)
      expect(b.calls).toBe(1) // the call still happened, even if usage was unreported
    })

    it('never throws from canAffordAnotherCall on a malformed budget', () => {
      expect(() => canAffordAnotherCall({} as unknown as GenerationBudget)).not.toThrow()
    })

    it('treats a malformed budget as allowed — fail-OPEN, matching every other gate here', () => {
      // Breaking generation because the meter is broken would be worse than
      // the overspend it is meant to prevent (same stance as build-credits.ts
      // and context-budget-chat.ts).
      expect(canAffordAnotherCall({} as unknown as GenerationBudget).allowed).toBe(true)
    })
  })
})

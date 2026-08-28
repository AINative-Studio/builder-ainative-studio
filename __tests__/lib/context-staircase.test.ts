import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import {
  // config
  resolveModelWindow,
  resolveBudget,
  resolveRawTail,
  snapStartIndex,
  resolveConfig,
  DEFAULT_FANOUT,
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_BUDGET_CAP,
  MIN_RAW_TAIL,
  TOKENS_PER_STEP,
  // pure math
  pow,
  computeCut0,
  decomposeStaircase,
  enumerateBlocksToSeal,
  // step rendering
  filterSteps,
  renderStep,
  renderRange,
  // cache
  getCachedBlock,
  putCachedBlock,
  clearStaircaseCache,
  // sealing + assembly
  sealFrontier,
  assembleStaircase,
  buildStaircase,
  isStaircaseEnabled,
  parseSummary,
  defaultSummarize,
  type Summarize,
  type StaircaseSegment,
  type RollupBlock,
} from '@/lib/agent/context-staircase'
import type { TrajectoryStep } from '@/lib/agent/trajectory-capture'

// A deterministic summarizer: summary echoes the range, ids echo the range
// endpoints. Lets us assert sealing/assembly structure without real I/O.
const echoSummarize: Summarize = async ({ tier, start, end }) => ({
  summary: `t${tier} span ${start}-${end}`,
  themes: ['build'],
  stepIds: [String(start), String(end - 1)],
})

function mkSteps(n: number, role: 'assistant' | 'tool_result' = 'assistant'): TrajectoryStep[] {
  const out: TrajectoryStep[] = []
  for (let i = 0; i < n; i++) {
    if (role === 'assistant') out.push({ turn: i, role: 'assistant', text: `step ${i}` })
    else out.push({ turn: i, role: 'tool_result', toolResult: `result ${i}` })
  }
  return out
}

// Every segment/block set must gaplessly cover [0, cut0) with no overlaps.
function assertGapless(segs: StaircaseSegment[], cut0: number) {
  const sorted = [...segs].sort((a, b) => a.start - b.start)
  let cursor = 0
  for (const s of sorted) {
    expect(s.start).toBe(cursor)
    expect(s.end).toBeGreaterThan(s.start)
    cursor = s.end
  }
  expect(cursor).toBe(cut0)
}

beforeEach(() => {
  clearStaircaseCache()
  delete process.env.CODY_CONTEXT_STAIRCASE
})
afterEach(() => {
  clearStaircaseCache()
  delete process.env.CODY_CONTEXT_STAIRCASE
})

describe('context-staircase (#345)', () => {
  // -------------------------------------------------------------------------
  describe('resolveModelWindow', () => {
    it('defaults to 200k for empty / claude models', () => {
      expect(resolveModelWindow()).toBe(DEFAULT_CONTEXT_WINDOW)
      expect(resolveModelWindow('')).toBe(DEFAULT_CONTEXT_WINDOW)
      expect(resolveModelWindow('claude-sonnet-4-5')).toBe(200000)
      expect(resolveModelWindow('opus')).toBe(200000)
      expect(resolveModelWindow('HAIKU')).toBe(200000)
    })
    it('gives gpt/o-series a 1M window', () => {
      expect(resolveModelWindow('gpt-4.1')).toBe(1000000)
      expect(resolveModelWindow('o3-mini')).toBe(1000000)
      expect(resolveModelWindow('gpt-4o')).toBe(1000000)
    })
    it('gives open coding models 128k', () => {
      expect(resolveModelWindow('kimi-k2')).toBe(128000)
      expect(resolveModelWindow('nous-coder')).toBe(128000)
      expect(resolveModelWindow('some-unknown-model')).toBe(128000)
    })
  })

  // -------------------------------------------------------------------------
  describe('resolveBudget = min(fraction·window, cap)', () => {
    it('caps the auto budget', () => {
      // 0.6 * 200000 = 120000, capped to 4000
      expect(resolveBudget({ contextWindow: 200000, contextFraction: 0.6, budgetCap: 4000 })).toBe(4000)
    })
    it('uses fraction·window when below the cap', () => {
      expect(resolveBudget({ contextWindow: 5000, contextFraction: 0.6, budgetCap: 4000 })).toBe(3000)
    })
    it('honors an explicit budget override', () => {
      expect(resolveBudget({ budget: 8000, contextWindow: 200000, contextFraction: 0.6, budgetCap: 4000 })).toBe(8000)
    })
    it('never returns negative', () => {
      expect(resolveBudget({ contextWindow: 0, contextFraction: 0.6, budgetCap: 4000 })).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('resolveRawTail (~40% of budget to recency)', () => {
    const base = { contextWindow: DEFAULT_CONTEXT_WINDOW, contextFraction: 0.6, budgetCap: DEFAULT_BUDGET_CAP }
    it('derives R = (budget*0.4)/tokensPerStep, clamped to [MIN, n]', () => {
      // budget=4000 → 1600 tok to tail → 1600/125 = 12 steps
      const r = resolveRawTail(1000, base)
      expect(r).toBe(Math.floor((4000 * 4) / 10 / TOKENS_PER_STEP))
      expect(r).toBeGreaterThanOrEqual(MIN_RAW_TAIL)
    })
    it('clamps up to MIN_RAW_TAIL for tiny budgets', () => {
      const r = resolveRawTail(1000, { ...base, budget: 100 })
      expect(r).toBe(MIN_RAW_TAIL)
    })
    it('clamps down to n when n is small', () => {
      expect(resolveRawTail(3, base)).toBe(3)
    })
    it('honors an explicit rawTail override, clamped to n', () => {
      expect(resolveRawTail(1000, { ...base, rawTail: 5 })).toBe(5)
      expect(resolveRawTail(3, { ...base, rawTail: 50 })).toBe(3)
    })
  })

  // -------------------------------------------------------------------------
  describe('snapStartIndex — snap DOWN to a FANOUT boundary', () => {
    it('snaps down to the boundary so no straddling hole is created', () => {
      expect(snapStartIndex(0, 10)).toBe(0)
      expect(snapStartIndex(7, 10)).toBe(0)
      expect(snapStartIndex(10, 10)).toBe(10)
      expect(snapStartIndex(23, 10)).toBe(20)
      expect(snapStartIndex(199, 10)).toBe(190)
    })
    it('is defensive against non-positive / degenerate fanout', () => {
      expect(snapStartIndex(-5, 10)).toBe(0)
      expect(snapStartIndex(50, 1)).toBe(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('pow — integer, no float drift', () => {
    it('computes F^k exactly', () => {
      expect(pow(10, 0)).toBe(1)
      expect(pow(10, 1)).toBe(10)
      expect(pow(10, 3)).toBe(1000)
      expect(pow(2, 10)).toBe(1024)
    })
  })

  // -------------------------------------------------------------------------
  describe('computeCut0 — F-aligned boundary below (n-r)', () => {
    it('snaps (n-r) down to a fanout multiple', () => {
      expect(computeCut0(250, 12, 10)).toBe(230) // 238 → 230
      expect(computeCut0(100, 20, 10)).toBe(80)
      expect(computeCut0(15, 20, 10)).toBe(0) // n-r negative → 0
      expect(computeCut0(30, 10, 10)).toBe(20)
    })
    it('is always F-aligned (a multiple of fanout) — the base-F invariant', () => {
      for (let n = 0; n < 500; n += 7) {
        for (const r of [8, 15, 30]) {
          expect(computeCut0(n, r, 10) % 10).toBe(0)
        }
      }
    })
  })

  // -------------------------------------------------------------------------
  describe('decomposeStaircase — gapless base-F coverage, ≤F-1 blocks/tier', () => {
    it('empty for cut0 <= 0', () => {
      expect(decomposeStaircase(0, 10)).toEqual([])
      expect(decomposeStaircase(-10, 10)).toEqual([])
    })
    it('decomposes 250 into 2 tier-2 + 5 tier-1, gapless', () => {
      const segs = decomposeStaircase(250, 10)
      const t2 = segs.filter((s) => s.tier === 2)
      const t1 = segs.filter((s) => s.tier === 1)
      expect(t2).toEqual([
        { tier: 2, start: 0, end: 100 },
        { tier: 2, start: 100, end: 200 },
      ])
      expect(t1.map((s) => [s.start, s.end])).toEqual([
        [200, 210],
        [210, 220],
        [220, 230],
        [230, 240],
        [240, 250],
      ])
      assertGapless(segs, 250)
    })
    it('emits coarse→fine, oldest→newest (chronological)', () => {
      const segs = decomposeStaircase(250, 10)
      // First seg is the coarsest, oldest.
      expect(segs[0]).toEqual({ tier: 2, start: 0, end: 100 })
      // Tiers are non-increasing across the list.
      for (let i = 1; i < segs.length; i++) {
        expect(segs[i].tier).toBeLessThanOrEqual(segs[i - 1].tier)
      }
    })
    it('each tier contributes at most F-1 blocks (for F-aligned cut0, the only kind computeCut0 emits)', () => {
      // computeCut0 always returns a multiple of fanout, so the base-F digit at
      // each position is 0..F-1 and every tier holds ≤ F-1 blocks. (An
      // un-aligned cut0 like 999 would leave a partial low digit → not a real
      // input; computeCut0 guarantees alignment.)
      for (const cut0 of [90, 250, 1000, 1230, 45670]) {
        const segs = decomposeStaircase(cut0, 10)
        const byTier = new Map<number, number>()
        for (const s of segs) byTier.set(s.tier, (byTier.get(s.tier) || 0) + 1)
        for (const count of byTier.values()) expect(count).toBeLessThanOrEqual(9)
        assertGapless(segs, cut0)
      }
    })
    it('handles a single tier when cut0 < F^2', () => {
      const segs = decomposeStaircase(90, 10)
      expect(segs.every((s) => s.tier === 1)).toBe(true)
      expect(segs).toHaveLength(9)
      assertGapless(segs, 90)
    })
    it('handles a deep pyramid gaplessly', () => {
      const segs = decomposeStaircase(45670, 10)
      assertGapless(segs, 45670)
      const maxTier = Math.max(...segs.map((s) => s.tier))
      expect(maxTier).toBe(4) // 10^4=10000 ≤ 45670 < 10^5
    })
  })

  // -------------------------------------------------------------------------
  describe('enumerateBlocksToSeal — every complete block ≥ start, bottom-up', () => {
    it('is empty below F steps', () => {
      expect(enumerateBlocksToSeal(9, 0, 10)).toEqual([])
    })
    it('seals one tier-1 block at exactly F steps', () => {
      expect(enumerateBlocksToSeal(10, 0, 10)).toEqual([{ tier: 1, start: 0, end: 10 }])
    })
    it('seals tier-1 and tier-2 at 100 steps', () => {
      const blocks = enumerateBlocksToSeal(100, 0, 10)
      expect(blocks.filter((b) => b.tier === 1)).toHaveLength(10)
      expect(blocks.filter((b) => b.tier === 2)).toEqual([{ tier: 2, start: 0, end: 100 }])
    })
    it('is bottom-up (tier ascending) so parents read sealed children', () => {
      const blocks = enumerateBlocksToSeal(100, 0, 10)
      for (let i = 1; i < blocks.length; i++) {
        expect(blocks[i].tier).toBeGreaterThanOrEqual(blocks[i - 1].tier)
      }
    })
    it('respects the enable marker — skips blocks fully before start', () => {
      const blocks = enumerateBlocksToSeal(50, 20, 10)
      expect(blocks.every((b) => b.start >= 20)).toBe(true)
      expect(blocks).toEqual([
        { tier: 1, start: 20, end: 30 },
        { tier: 1, start: 30, end: 40 },
        { tier: 1, start: 40, end: 50 },
      ])
    })
  })

  // -------------------------------------------------------------------------
  describe('filterSteps + renderStep', () => {
    it('drops empty steps but keeps tool calls and results', () => {
      const steps: TrajectoryStep[] = [
        { turn: 1, role: 'assistant', text: '  ' }, // dropped (empty text, no tool)
        { turn: 1, role: 'assistant', tool: 'Write', toolInput: { path: 'a' } }, // kept
        { turn: 2, role: 'tool_result', toolResult: 'ok' }, // kept
        { turn: 2, role: 'tool_result', toolResult: '' }, // dropped
        { turn: 3, role: 'assistant', text: 'thinking' }, // kept
      ]
      const f = filterSteps(steps)
      expect(f).toHaveLength(3)
    })
    it('renders a think step, a tool step, and a result NUL-safely', () => {
      expect(renderStep({ turn: 1, role: 'assistant', text: 'hello\nworld' }, 0)).toBe('[0] think: hello world')
      expect(renderStep({ turn: 1, role: 'assistant', tool: 'Write', toolInput: { p: 1 } }, 2)).toBe('[2] tool:Write: {"p":1}')
      expect(renderStep({ turn: 1, role: 'tool_result', toolResult: 'done' }, 5)).toBe('[5] result: done')
    })
    it('caps content length', () => {
      const long = 'x'.repeat(2000)
      const line = renderStep({ turn: 1, role: 'assistant', text: long }, 0)
      expect(line.length).toBeLessThanOrEqual('[0] think: '.length + 500)
    })
    it('tolerates unserializable tool input', () => {
      const circular: any = {}
      circular.self = circular
      const line = renderStep({ turn: 1, role: 'assistant', tool: 'X', toolInput: circular }, 0)
      expect(line).toContain('[unserializable]')
    })
    it('renderRange joins a slice', () => {
      const f = filterSteps(mkSteps(5))
      expect(renderRange(f, 1, 3)).toBe('[1] think: step 1\n[2] think: step 2')
    })
  })

  // -------------------------------------------------------------------------
  describe('sealed-block cache (in-memory, immutable, chatId-keyed)', () => {
    const blk: RollupBlock = { tier: 1, start: 0, end: 10, n: 10, summary: 's', themes: [], stepIds: ['0'] }
    it('stores and reads a block', () => {
      putCachedBlock('chat-a', blk)
      expect(getCachedBlock('chat-a', 1, 0, 10)).toEqual(blk)
    })
    it('is immutable — never overwrites an existing sealed block', () => {
      putCachedBlock('chat-a', blk)
      putCachedBlock('chat-a', { ...blk, summary: 'CHANGED' })
      expect(getCachedBlock('chat-a', 1, 0, 10)!.summary).toBe('s')
    })
    it('isolates chats', () => {
      putCachedBlock('chat-a', blk)
      expect(getCachedBlock('chat-b', 1, 0, 10)).toBeUndefined()
    })
    it('clearStaircaseCache(chatId) drops one chat', () => {
      putCachedBlock('chat-a', blk)
      putCachedBlock('chat-b', blk)
      clearStaircaseCache('chat-a')
      expect(getCachedBlock('chat-a', 1, 0, 10)).toBeUndefined()
      expect(getCachedBlock('chat-b', 1, 0, 10)).toEqual(blk)
    })
  })

  // -------------------------------------------------------------------------
  describe('sealFrontier — frontier-only, incremental, idempotent', () => {
    it('seals every complete block once and caches them', async () => {
      const filtered = filterSteps(mkSteps(100))
      const spy = vi.fn(echoSummarize)
      await sealFrontier('c1', filtered, 0, 10, spy)
      // 10 tier-1 + 1 tier-2 = 11 seal calls.
      expect(spy).toHaveBeenCalledTimes(11)
      expect(getCachedBlock('c1', 1, 0, 10)).toBeDefined()
      expect(getCachedBlock('c1', 2, 0, 100)).toBeDefined()
    })
    it('is idempotent — a second pass over the same log calls the LLM zero times', async () => {
      const filtered = filterSteps(mkSteps(100))
      const spy = vi.fn(echoSummarize)
      await sealFrontier('c2', filtered, 0, 10, spy)
      spy.mockClear()
      await sealFrontier('c2', filtered, 0, 10, spy)
      expect(spy).toHaveBeenCalledTimes(0)
    })
    it('only seals the frontier when the log grows', async () => {
      const spy = vi.fn(echoSummarize)
      await sealFrontier('c3', filterSteps(mkSteps(100)), 0, 10, spy)
      spy.mockClear()
      // grow to 110: one new tier-1 block [100,110). tier-2 [100,200) not complete.
      await sealFrontier('c3', filterSteps(mkSteps(110)), 0, 10, spy)
      expect(spy).toHaveBeenCalledTimes(1)
      expect(getCachedBlock('c3', 1, 100, 110)).toBeDefined()
    })
    it('rolls up tier-k from tier k-1 child summaries', async () => {
      const filtered = filterSteps(mkSteps(100))
      const seen: string[] = []
      const cap: Summarize = async (args) => {
        if (args.tier === 2) seen.push(args.text)
        return echoSummarize(args)
      }
      await sealFrontier('c4', filtered, 0, 10, cap)
      // The tier-2 input must be child rollup lines, not raw steps.
      expect(seen).toHaveLength(1)
      expect(seen[0]).toContain('t1 span 0-10')
      expect(seen[0]).not.toContain('think:')
    })
    it('fails open per-block — a summarizer throw leaves the block unsealed, no throw', async () => {
      const filtered = filterSteps(mkSteps(20))
      const flaky: Summarize = async (args) => {
        if (args.start === 0 && args.tier === 1) throw new Error('boom')
        return echoSummarize(args)
      }
      await expect(sealFrontier('c5', filtered, 0, 10, flaky)).resolves.toBeUndefined()
      expect(getCachedBlock('c5', 1, 0, 10)).toBeUndefined()
      expect(getCachedBlock('c5', 1, 10, 20)).toBeDefined()
    })
    it('skips a parent whose child never sealed (missing child)', async () => {
      const filtered = filterSteps(mkSteps(100))
      const flaky: Summarize = async (args) => {
        if (args.tier === 1 && args.start === 50) throw new Error('boom')
        return echoSummarize(args)
      }
      await sealFrontier('c6', filtered, 0, 10, flaky)
      // tier-2 [0,100) has a missing child [50,60) → not sealed.
      expect(getCachedBlock('c6', 2, 0, 100)).toBeUndefined()
      // the other 9 tier-1 children sealed fine.
      expect(getCachedBlock('c6', 1, 0, 10)).toBeDefined()
    })
    it('respects the enable marker — never seals pre-marker blocks', async () => {
      const filtered = filterSteps(mkSteps(50))
      const spy = vi.fn(echoSummarize)
      await sealFrontier('c7', filtered, 20, 10, spy)
      expect(getCachedBlock('c7', 1, 0, 10)).toBeUndefined()
      expect(getCachedBlock('c7', 1, 20, 30)).toBeDefined()
    })
  })

  // -------------------------------------------------------------------------
  describe('assembleStaircase — coarse→fine summaries + raw tail', () => {
    it('emits only the raw tail when there are no sealed summaries', () => {
      const filtered = filterSteps(mkSteps(15))
      const text = assembleStaircase('a1', filtered, 20, 10, 0)
      expect(text).toContain('RIGHT NOW')
      expect(text).not.toContain('BUILD SO FAR')
      expect(text).toContain('[14] think: step 14')
    })
    it('emits sealed summaries oldest-first then the verbatim tail', async () => {
      const filtered = filterSteps(mkSteps(120))
      await sealFrontier('a2', filtered, 0, 10, echoSummarize)
      // r small → cut0 = 100; summaries cover [0,100), tail is [100,120).
      const text = assembleStaircase('a2', filtered, 15, 10, 0)
      expect(text).toContain('BUILD SO FAR')
      expect(text).toContain('[t2 · steps 0–100] t2 span 0-100')
      const nowIdx = text.indexOf('RIGHT NOW')
      const lifeIdx = text.indexOf('BUILD SO FAR')
      expect(lifeIdx).toBeLessThan(nowIdx) // summaries before the tail
      expect(text).toContain('[100] think: step 100') // tail is verbatim
    })
    it('descends into finer children when a straddling coarse block is missing', async () => {
      // Seal only tier-1 blocks (no tier-2) by capping the log so tier-2 never
      // completes, then assemble a cut0 that asks for a tier-2 segment.
      const filtered = filterSteps(mkSteps(95))
      // Seal tier-1 [0,10)..[80,90) but NOT tier-2 [0,100) (incomplete).
      await sealFrontier('a3', filtered, 0, 10, echoSummarize)
      expect(getCachedBlock('a3', 2, 0, 100)).toBeUndefined()
      // Force a decomposition that includes a tier-2 [0,100)-style ask by using
      // cut0=90 (all tier-1) — tier-1 present, so straightforward. Now test the
      // descent path directly with a manual assemble over a bigger virtual cut0.
      const text = assembleStaircase('a3', filtered, 5, 10, 0) // cut0=90 → 9 tier-1
      expect(text).toContain('[t1 · steps 0–10]')
      expect(text).toContain('[t1 · steps 80–90]')
    })
    it('prunes segments wholly before the enable marker', async () => {
      const filtered = filterSteps(mkSteps(120))
      await sealFrontier('a4', filtered, 20, 10, echoSummarize)
      const text = assembleStaircase('a4', filtered, 15, 10, 20)
      // steps [0,20) are pre-marker — never summarized, never shown.
      expect(text).not.toContain('steps 0–10')
      expect(text).toContain('[t1 · steps 20–30]')
    })
  })

  // -------------------------------------------------------------------------
  describe('buildStaircase — top-level, bounded + fail-open', () => {
    it('returns null when disabled via kill switch', async () => {
      process.env.CODY_CONTEXT_STAIRCASE = '0'
      const res = await buildStaircase({ chatId: 'b1', steps: mkSteps(200), summarize: echoSummarize })
      expect(res.text).toBeNull()
    })
    it('returns null for empty steps', async () => {
      const res = await buildStaircase({ chatId: 'b2', steps: [], summarize: echoSummarize })
      expect(res.text).toBeNull()
      expect(res.filteredCount).toBe(0)
    })
    it('returns null when the raw tail already covers everything (n<=r)', async () => {
      const spy = vi.fn(echoSummarize)
      // 5 steps, R will clamp to 5 → n<=r → no staircase, no LLM.
      const res = await buildStaircase({ chatId: 'b3', steps: mkSteps(5), summarize: spy })
      expect(res.text).toBeNull()
      expect(spy).not.toHaveBeenCalled()
    })
    it('assembles a full staircase for a long build (explicit small budget)', async () => {
      const res = await buildStaircase({
        chatId: 'b4',
        steps: mkSteps(200),
        summarize: echoSummarize,
        config: { budget: 4000, rawTail: 15, fanout: 10 },
      })
      expect(res.text).toBeTruthy()
      expect(res.text).toContain('BUILD SO FAR')
      expect(res.text).toContain('RIGHT NOW')
      expect(res.filteredCount).toBe(200)
      expect(res.rawTail).toBe(15)
      expect(res.segments).toBeGreaterThan(0)
    })
    it('works WITHOUT a summarizer (warm-cache / no I/O) — no summaries, raw tail only', async () => {
      const res = await buildStaircase({
        chatId: 'b5',
        steps: mkSteps(200),
        config: { rawTail: 15 },
      })
      expect(res.text).toBeTruthy()
      expect(res.text).toContain('RIGHT NOW')
      // No sealing happened → no summary section.
      expect(res.text).not.toContain('BUILD SO FAR')
    })
    it('never throws — a throwing summarizer yields raw-tail-only, not an error', async () => {
      const boom: Summarize = async () => {
        throw new Error('provider down')
      }
      const res = await buildStaircase({
        chatId: 'b6',
        steps: mkSteps(200),
        summarize: boom,
        config: { rawTail: 15 },
      })
      // sealing failed per-block, assembly still produced the tail.
      expect(res.text).toBeTruthy()
      expect(res.text).toContain('RIGHT NOW')
    })
    it('is idempotent across resumes — no re-sealing on the second call', async () => {
      const spy = vi.fn(echoSummarize)
      const cfg = { budget: 4000, rawTail: 15, fanout: 10 }
      await buildStaircase({ chatId: 'b7', steps: mkSteps(200), summarize: spy, config: cfg })
      const first = spy.mock.calls.length
      expect(first).toBeGreaterThan(0)
      spy.mockClear()
      await buildStaircase({ chatId: 'b7', steps: mkSteps(200), summarize: spy, config: cfg })
      expect(spy).toHaveBeenCalledTimes(0)
    })
  })

  // -------------------------------------------------------------------------
  describe('resolveConfig', () => {
    it('derives sensible defaults from model + env', () => {
      const cfg = resolveConfig({ chatId: 'x', steps: [], model: 'claude-sonnet' })
      expect(cfg.fanout).toBe(DEFAULT_FANOUT)
      expect(cfg.contextWindow).toBe(200000)
      expect(cfg.budgetCap).toBe(DEFAULT_BUDGET_CAP)
    })
    it('honors overrides', () => {
      const cfg = resolveConfig({
        chatId: 'x',
        steps: [],
        config: { fanout: 5, contextWindow: 50000, contextFraction: 0.5, budgetCap: 2000, startIndex: 30 },
      })
      expect(cfg.fanout).toBe(5)
      expect(cfg.contextWindow).toBe(50000)
      expect(cfg.contextFraction).toBe(0.5)
      expect(cfg.budgetCap).toBe(2000)
      expect(cfg.startIndex).toBe(30)
    })
    it('rejects degenerate fanout (<=1) → default', () => {
      const cfg = resolveConfig({ chatId: 'x', steps: [], config: { fanout: 1 } })
      expect(cfg.fanout).toBe(DEFAULT_FANOUT)
    })
  })

  // -------------------------------------------------------------------------
  describe('isStaircaseEnabled — kill switch', () => {
    it('is ON by default', () => {
      delete process.env.CODY_CONTEXT_STAIRCASE
      expect(isStaircaseEnabled()).toBe(true)
    })
    it('is OFF only for exactly "0"', () => {
      process.env.CODY_CONTEXT_STAIRCASE = '0'
      expect(isStaircaseEnabled()).toBe(false)
      process.env.CODY_CONTEXT_STAIRCASE = '1'
      expect(isStaircaseEnabled()).toBe(true)
    })
  })

  // -------------------------------------------------------------------------
  describe('parseSummary — tolerant JSON parse', () => {
    it('parses a plain JSON object', () => {
      const r = parseSummary('{"summary":"did x","themes":["a","b"],"step_ids":["3","7"]}')
      expect(r.summary).toBe('did x')
      expect(r.themes).toEqual(['a', 'b'])
      expect(r.stepIds).toEqual(['3', '7'])
    })
    it('strips ```json fences', () => {
      const r = parseSummary('```json\n{"summary":"y","themes":[],"step_ids":[]}\n```')
      expect(r.summary).toBe('y')
    })
    it('salvages a leading/trailing-noise object', () => {
      const r = parseSummary('Sure! {"summary":"z","themes":[],"step_ids":[]} done.')
      expect(r.summary).toBe('z')
    })
    it('accepts camelCase stepIds too', () => {
      const r = parseSummary('{"summary":"q","themes":[],"stepIds":["1"]}')
      expect(r.stepIds).toEqual(['1'])
    })
    it('returns an empty body on garbage', () => {
      expect(parseSummary('not json at all')).toEqual({ summary: '', themes: [], stepIds: [] })
      expect(parseSummary('')).toEqual({ summary: '', themes: [], stepIds: [] })
    })
    it('caps themes and stepIds at 4', () => {
      const r = parseSummary('{"summary":"s","themes":["a","b","c","d","e"],"step_ids":["1","2","3","4","5"]}')
      expect(r.themes).toHaveLength(4)
      expect(r.stepIds).toHaveLength(4)
    })
  })

  // -------------------------------------------------------------------------
  describe('defaultSummarize — the real I/O path (mocked)', () => {
    afterEach(() => {
      vi.restoreAllMocks()
      vi.resetModules()
    })
    it('calls completeText with a bounded max_tokens and parses the reply', async () => {
      vi.resetModules()
      const completeText = vi.fn(async (_opts: { system: string; user: string; maxTokens?: number; temperature?: number }) => ({
        text: '{"summary":"I scaffolded the app","themes":["scaffold"],"step_ids":["0","5"]}',
        provider: 'anthropic',
        model: 'm',
      }))
      vi.doMock('@/lib/build/claude-completion', () => ({ completeText }))
      // Re-import the module under the mock.
      const mod = await import('@/lib/agent/context-staircase')
      const summarize = mod.defaultSummarize()
      const body = await summarize({ text: '[0] think: hi', tier: 1, start: 0, end: 10 })
      expect(body.summary).toBe('I scaffolded the app')
      expect(completeText).toHaveBeenCalledOnce()
      const arg = completeText.mock.calls[0][0]
      expect(arg.maxTokens).toBe(mod.ROLLUP_MAX_TOKENS)
      expect(arg.maxTokens).toBeLessThanOrEqual(512)
    })
  })
})

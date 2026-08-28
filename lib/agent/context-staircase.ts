/**
 * Tiered-recap context compaction for the Cody agent (issue #345).
 *
 * Ported CONCEPT (not the Bash) from headlong `bin/recap --context` +
 * design/tiered_memory.md. A logarithmic pyramid of immutable sealed summary
 * blocks keyed by filtered-step-index range gives a single BOUNDED context that
 * always spans the WHOLE build: coarse→fine rollups covering [0, cut0) then the
 * raw tail [cut0, N) verbatim. This attacks build DEPTH — a resuming/continuing
 * build carries whole-build state at bounded tokens instead of a forgetful
 * linear window.
 *
 * Design lifted exactly from headlong (the correctness details worth stealing):
 *   1. FRONTIER-ONLY sealing — only newly-complete blocks call the LLM;
 *      everything sealed is immutable and cached forever (incremental +
 *      idempotent).
 *   2. enable-marker snapped DOWN to a FANOUT boundary so there is never a
 *      permanent coverage hole at the enable point.
 *   3. positional base-F decomposition of the older region → gapless coverage,
 *      each tier contributes ≤ F-1 blocks.
 *   4. budget = min(0.6·window, cap) with ~40% to the raw tail.
 *   5. 'straddling' coarse blocks descend into built children rather than
 *      dropping summarized history.
 *
 * I/O boundary: the ONLY side effect is the summarize LLM call (injected —
 * defaults to a bounded `completeText`). Everything else — window ranges,
 * base-F decomposition, budget math, assembly — is pure and deterministic.
 *
 * Storage: an in-memory sealed-block cache keyed by chatId (globalThis map with
 * a TTL), mirroring the preview-store pattern. NO ZeroDB dependency — a harness
 * experiment must never add a hard I/O dependency to a real build.
 *
 * Bounded + fail-open: every entry point swallows its own failures and the
 * caller falls back to the current linear window. Kill switch:
 * CODY_CONTEXT_STAIRCASE=0.
 */

import type { TrajectoryStep } from './trajectory-capture'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A sealed, immutable rollup block over a filtered-step index range [start,end). */
export interface RollupBlock {
  tier: number
  /** Inclusive start filtered-step index. */
  start: number
  /** Exclusive end filtered-step index. */
  end: number
  /** Number of filtered steps this block covers (end - start). */
  n: number
  /** First-person 2-3 sentence summary of the span. */
  summary: string
  /** 1-4 short kebab-case topics. */
  themes: string[]
  /** A few notable step anchors (turn indices) carried up the pyramid. */
  stepIds: string[]
}

/** One segment of the staircase: a tier-k block covering [start,end). */
export interface StaircaseSegment {
  tier: number
  start: number
  end: number
}

/** Injected bounded summarizer. Returns the rollup body (summary/themes/ids). */
export type Summarize = (input: {
  /** Rendered lines: raw "[turn] tool: text" steps, or child rollup lines. */
  text: string
  tier: number
  start: number
  end: number
}) => Promise<{ summary: string; themes: string[]; stepIds: string[] }>

export interface StaircaseConfig {
  /** Fanout F — steps per tier-1 entry, children per higher tier. Default 10. */
  fanout: number
  /** Model context window in tokens (for the auto budget). Default 200000. */
  contextWindow: number
  /** Fraction of the window to fill. Default 0.6. */
  contextFraction: number
  /** Absolute cap on the auto budget in tokens. Default 4000. */
  budgetCap: number
  /** Explicit token budget; overrides the auto (window·fraction, cap) budget. */
  budget?: number
  /** Explicit raw-tail size R; overrides the derived R. */
  rawTail?: number
  /** Enable marker (filtered-step index tiered memory builds forward from). */
  startIndex: number
}

// ---------------------------------------------------------------------------
// Config resolution
// ---------------------------------------------------------------------------

export const DEFAULT_FANOUT = 10
export const DEFAULT_CONTEXT_WINDOW = 200000
export const DEFAULT_CONTEXT_FRACTION = 0.6
export const DEFAULT_BUDGET_CAP = 4000
/**
 * Worst-case tokens per rendered step: content is capped and rendered at
 * ~4 chars/token; budget the WORST case, not the mean — overshooting the window
 * truncates the agent's context while undershooting merely shortens it. Mirrors
 * headlong's 125 tok/step.
 */
export const TOKENS_PER_STEP = 125
/** Minimum raw tail — always show at least this many recent steps verbatim. */
export const MIN_RAW_TAIL = 8

/**
 * Resolve the token window for a model name. Deliberately a tiny lookup with a
 * safe default — this is a budget knob, not a billing-accurate count. Mirrors
 * headlong `_ctx_model_window`.
 */
export function resolveModelWindow(model?: string): number {
  const m = (model || '').toLowerCase()
  if (!m) return DEFAULT_CONTEXT_WINDOW
  if (/claude|opus|sonnet|haiku/.test(m)) return DEFAULT_CONTEXT_WINDOW
  if (/gpt-4\.1|o1|o3|o4|gpt-4o/.test(m)) return 1000000
  if (/kimi|qwen|llama|nous|deepseek/.test(m)) return 128000
  return 128000
}

/**
 * Resolve the token budget = min(fraction·window, cap), or the explicit budget.
 * Pure.
 */
export function resolveBudget(cfg: Pick<StaircaseConfig, 'budget' | 'contextWindow' | 'contextFraction' | 'budgetCap'>): number {
  if (typeof cfg.budget === 'number' && cfg.budget > 0) return Math.floor(cfg.budget)
  const raw = Math.floor(cfg.contextWindow * cfg.contextFraction)
  return Math.max(0, Math.min(raw, cfg.budgetCap))
}

/**
 * Resolve the raw-tail size R from the budget. Recency gets ~40% of the budget;
 * R is clamped to [MIN_RAW_TAIL, n]. Pure. Mirrors headlong `_ctx_resolve_R`.
 */
export function resolveRawTail(n: number, cfg: Pick<StaircaseConfig, 'rawTail' | 'budget' | 'contextWindow' | 'contextFraction' | 'budgetCap'>): number {
  if (typeof cfg.rawTail === 'number' && cfg.rawTail >= 0) {
    return Math.min(cfg.rawTail, n)
  }
  const budget = resolveBudget(cfg)
  let r = Math.floor((budget * 4) / 10 / TOKENS_PER_STEP)
  if (r < MIN_RAW_TAIL) r = MIN_RAW_TAIL
  if (r > n) r = n
  return r
}

/**
 * Snap the enable marker DOWN to a FANOUT boundary. An unsnapped marker leaves
 * the block straddling it unbuildable forever (its oldest child is pre-enable),
 * a permanent coverage hole at the enable point. Pure. Mirrors headlong
 * `_ctx_start_index`.
 */
export function snapStartIndex(rawStart: number, fanout: number): number {
  if (rawStart <= 0 || fanout <= 1) return 0
  return Math.floor(rawStart / fanout) * fanout
}

// ---------------------------------------------------------------------------
// Positional base-F decomposition of the older region → staircase segments
// ---------------------------------------------------------------------------

/** F^e, computed with integer multiplication (avoids Math.pow float drift). */
export function pow(base: number, exp: number): number {
  let r = 1
  for (let i = 0; i < exp; i++) r *= base
  return r
}

/**
 * cut0 = the F-aligned boundary just below (n - r): the older region [0, cut0)
 * is covered by rollups, [cut0, n) is the raw tail. Pure.
 */
export function computeCut0(n: number, r: number, fanout: number): number {
  const cut0 = Math.floor((n - r) / fanout) * fanout
  return cut0 < 0 ? 0 : cut0
}

/**
 * Decompose [0, cut0) into staircase segments via positional base-F expansion:
 * for each tier k=1.., the digit of cut0 in base F at position k contributes
 * that many tier-k blocks (each of width F^k) filling the region just older
 * than what finer tiers already covered. Coverage is gapless and each tier
 * contributes at most F-1 blocks. Pure. Mirrors headlong `_ctx_assemble`.
 *
 * Returned in the order headlong emits them for context: coarse→fine (highest
 * tier first) and, within a tier, oldest→newest — which is exactly chronological
 * since coarser blocks always cover strictly older regions.
 */
export function decomposeStaircase(cut0: number, fanout: number): StaircaseSegment[] {
  const segs: StaircaseSegment[] = []
  if (cut0 <= 0 || fanout <= 1) return segs
  let remaining = cut0
  let tier = 1
  // Guard against pathological configs: tier can never exceed log_F(cut0)+1.
  const maxTierGuard = 64
  while (remaining > 0 && tier < maxTierGuard) {
    const blk = pow(fanout, tier)
    const coarser = blk * fanout
    // The base-F "digit" at this position: how much of `remaining` this tier
    // must absorb before the next (coarser) tier takes over.
    const chunk = remaining - Math.floor(remaining / coarser) * coarser
    if (chunk > 0) {
      const a = remaining - chunk
      for (let x = a; x < remaining; x += blk) {
        segs.push({ tier, start: x, end: x + blk })
      }
    }
    remaining -= chunk
    tier++
    if (blk > cut0) break
  }
  // Emit coarse→fine (highest tier first), oldest→newest within a tier.
  const maxTier = segs.reduce((mx, s) => (s.tier > mx ? s.tier : mx), 0)
  const ordered: StaircaseSegment[] = []
  for (let t = maxTier; t >= 1; t--) {
    for (const s of segs) {
      if (s.tier === t) ordered.push(s)
    }
  }
  return ordered
}

/**
 * Enumerate every complete block (tier ≥ 1) at or after `start` that a full
 * trajectory of `n` filtered steps would seal, bottom-up. This is the set the
 * frontier builder must ensure exists. Pure — it decides WHAT to seal, not how.
 * Mirrors headlong `_ctx_build`.
 */
export function enumerateBlocksToSeal(n: number, start: number, fanout: number): StaircaseSegment[] {
  const out: StaircaseSegment[] = []
  if (fanout <= 1) return out
  let tier = 1
  let blk = fanout
  const maxTierGuard = 64
  while (blk <= n && tier < maxTierGuard) {
    const nblocks = Math.floor(n / blk)
    for (let b = 0; b < nblocks; b++) {
      const s = b * blk
      const e = (b + 1) * blk
      if (s < start) continue
      out.push({ tier, start: s, end: e })
    }
    tier++
    blk *= fanout
  }
  return out
}

// ---------------------------------------------------------------------------
// Step filtering + rendering (the tier-0 source lines)
// ---------------------------------------------------------------------------

/**
 * Keep only signal-bearing steps for summarization (drop empty/noise). The raw
 * tail keeps everything, but rollup tiers summarize the FILTERED stream so a
 * block of noise collapses to one line. Mirrors recap's filter discipline.
 */
export function filterSteps(steps: TrajectoryStep[]): TrajectoryStep[] {
  return steps.filter((s) => {
    if (!s) return false
    if (s.role === 'assistant') {
      return Boolean((s.text && s.text.trim()) || s.tool)
    }
    if (s.role === 'tool_result') {
      return Boolean(s.toolResult && s.toolResult.trim())
    }
    return false
  })
}

const STEP_CONTENT_CAP = 500

/** Render one filtered step to a NUL-safe single line "[turn] kind: content". */
export function renderStep(step: TrajectoryStep, index: number): string {
  const id = String(index)
  let kind: string
  let content: string
  if (step.role === 'assistant') {
    if (step.tool) {
      kind = `tool:${step.tool}`
      let inp = ''
      try {
        inp = step.toolInput != null ? JSON.stringify(step.toolInput) : ''
      } catch {
        inp = '[unserializable]'
      }
      content = inp
    } else {
      kind = 'think'
      content = step.text || ''
    }
  } else {
    kind = 'result'
    content = step.toolResult || ''
  }
  content = content.replace(/\s+/g, ' ').trim().slice(0, STEP_CONTENT_CAP)
  return `[${id}] ${kind}: ${content}`
}

/** Render a contiguous slice [s,e) of filtered steps to newline-joined lines. */
export function renderRange(filtered: TrajectoryStep[], s: number, e: number): string {
  const lines: string[] = []
  for (let i = s; i < e && i < filtered.length; i++) {
    lines.push(renderStep(filtered[i], i))
  }
  return lines.join('\n')
}

// ---------------------------------------------------------------------------
// Sealed-block cache (in-memory, chatId-keyed, TTL) — NO ZeroDB
// ---------------------------------------------------------------------------

interface CacheEntry {
  blocks: Map<string, RollupBlock>
  touched: number
}

declare global {
  // eslint-disable-next-line no-var
  var __codyStaircaseCache: Map<string, CacheEntry> | undefined
}

/** TTL for a chat's sealed-block cache (ms). A build is minutes; keep an hour. */
export const CACHE_TTL_MS = 60 * 60 * 1000
/** Cap on distinct chats held resident (LRU-ish eviction of the oldest). */
export const CACHE_MAX_CHATS = 256

function cache(): Map<string, CacheEntry> {
  if (!globalThis.__codyStaircaseCache) {
    globalThis.__codyStaircaseCache = new Map<string, CacheEntry>()
  }
  return globalThis.__codyStaircaseCache
}

function blockKey(tier: number, start: number, end: number): string {
  return `t${tier}:${start}-${end}`
}

function pruneExpired(now: number): void {
  const c = cache()
  for (const [chatId, entry] of c) {
    if (now - entry.touched > CACHE_TTL_MS) c.delete(chatId)
  }
  if (c.size > CACHE_MAX_CHATS) {
    // Evict oldest-touched until under cap.
    const sorted = [...c.entries()].sort((a, b) => a[1].touched - b[1].touched)
    for (const [chatId] of sorted) {
      if (c.size <= CACHE_MAX_CHATS) break
      c.delete(chatId)
    }
  }
}

function getEntry(chatId: string): CacheEntry {
  const now = Date.now()
  pruneExpired(now)
  const c = cache()
  let entry = c.get(chatId)
  if (!entry) {
    entry = { blocks: new Map(), touched: now }
    c.set(chatId, entry)
  }
  entry.touched = now
  return entry
}

/** Read a sealed block from the cache (undefined if not yet sealed). */
export function getCachedBlock(chatId: string, tier: number, start: number, end: number): RollupBlock | undefined {
  const entry = getEntry(chatId)
  return entry.blocks.get(blockKey(tier, start, end))
}

/** Store a sealed block (immutable — never overwrites an existing one). */
export function putCachedBlock(chatId: string, block: RollupBlock): void {
  const entry = getEntry(chatId)
  const key = blockKey(block.tier, block.start, block.end)
  if (!entry.blocks.has(key)) entry.blocks.set(key, block)
}

/** Test/reset hook: drop a chat's cache (or all if no chatId). */
export function clearStaircaseCache(chatId?: string): void {
  if (chatId) cache().delete(chatId)
  else cache().clear()
}

// ---------------------------------------------------------------------------
// Frontier sealing (the only I/O — the injected summarizer)
// ---------------------------------------------------------------------------

/**
 * Seal every complete block at or after `start` that is not already cached,
 * bottom-up (tier 1 from raw steps, tier k from tier k-1 child summaries). Only
 * the frontier (newly-complete, uncached blocks) calls the summarizer; sealed
 * blocks are immutable and reused forever. Fail-open per-block: a summarizer
 * failure or a missing child leaves that block unsealed (the assembler descends
 * into finer children for coverage) — it never throws.
 */
export async function sealFrontier(
  chatId: string,
  filtered: TrajectoryStep[],
  start: number,
  fanout: number,
  summarize: Summarize,
): Promise<void> {
  const n = filtered.length
  const toSeal = enumerateBlocksToSeal(n, start, fanout)
  // enumerateBlocksToSeal returns tier-ascending already (bottom-up), which is
  // required: tier k reads tier k-1 blocks that must be sealed first.
  for (const seg of toSeal) {
    const { tier, start: s, end: e } = seg
    if (getCachedBlock(chatId, tier, s, e)) continue
    try {
      let text: string
      let fallbackIds: string[]
      if (tier === 1) {
        text = renderRange(filtered, s, e)
        fallbackIds = [String(s), String(e - 1)]
      } else {
        const childBlk = pow(fanout, tier - 1)
        const childLines: string[] = []
        const childIds: string[] = []
        let missing = false
        for (let c = s; c < e; c += childBlk) {
          const child = getCachedBlock(chatId, tier - 1, c, c + childBlk)
          if (!child) {
            missing = true
            break
          }
          childLines.push(`[${child.stepIds.join(',')}] ${child.summary}`)
          if (child.stepIds[0]) childIds.push(child.stepIds[0])
        }
        // A child never sealed (its own summarizer failed) — skip this parent;
        // the assembler will descend into whichever children DO exist.
        if (missing) continue
        text = childLines.join('\n')
        fallbackIds = childIds.slice(0, 4)
      }
      if (!text.trim()) continue
      const body = await summarize({ text, tier, start: s, end: e })
      const summary = (body.summary || '').trim()
      const themes = Array.isArray(body.themes) ? body.themes.slice(0, 4).map(String) : []
      let stepIds = Array.isArray(body.stepIds) ? body.stepIds.slice(0, 4).map(String) : []
      if (stepIds.length === 0) stepIds = fallbackIds
      putCachedBlock(chatId, { tier, start: s, end: e, n: e - s, summary, themes, stepIds })
    } catch {
      // Fail-open: leave this block unsealed. Coverage is preserved by the
      // assembler descending into finer children.
    }
  }
}

// ---------------------------------------------------------------------------
// Staircase assembly (pure over the cache)
// ---------------------------------------------------------------------------

/**
 * Emit one staircase segment as labeled lines. A cached block prints its
 * summary. A missing block that STRADDLES the enable marker (or whose parent
 * never sealed) descends into its F children one tier down and prints whatever
 * exists — never dropping built summaries. A tier-1 miss is truly absent
 * history (pre-marker or unsealed) and contributes nothing. Pure. Mirrors
 * headlong `_ctx_emit_seg`.
 */
function emitSegment(
  chatId: string,
  seg: StaircaseSegment,
  fanout: number,
  start: number,
  out: string[],
): void {
  const { tier, start: s, end: e } = seg
  // Prune segments wholly before the enable marker: nothing is built there.
  if (e <= start) return
  const block = getCachedBlock(chatId, tier, s, e)
  if (block) {
    const ids = block.stepIds.length ? `   (${block.stepIds.join(' ')})` : ''
    out.push(`[t${tier} · steps ${s}–${e}] ${block.summary}${ids}`)
    return
  }
  if (tier <= 1) return
  const childBlk = pow(fanout, tier - 1)
  for (let c = s; c < e; c += childBlk) {
    emitSegment(chatId, { tier: tier - 1, start: c, end: c + childBlk }, fanout, start, out)
  }
}

/**
 * Assemble the full staircase string: coarse→fine summaries over [0, cut0),
 * then the raw tail [cut0, n) verbatim. Pure over the cache + filtered steps.
 */
export function assembleStaircase(
  chatId: string,
  filtered: TrajectoryStep[],
  r: number,
  fanout: number,
  start: number,
): string {
  const n = filtered.length
  const cut0 = computeCut0(n, r, fanout)
  const segs = decomposeStaircase(cut0, fanout)

  const summaryLines: string[] = []
  for (const seg of segs) {
    emitSegment(chatId, seg, fanout, start, summaryLines)
  }

  const parts: string[] = []
  if (summaryLines.length > 0) {
    parts.push('=== YOUR BUILD SO FAR — summarized, oldest first ===')
    parts.push(...summaryLines)
    parts.push('')
  }
  const tailCount = n - cut0
  parts.push(`=== RIGHT NOW — the last ${tailCount} steps, verbatim ===`)
  parts.push(renderRange(filtered, cut0, n))
  return parts.join('\n')
}

// ---------------------------------------------------------------------------
// Top-level entry point
// ---------------------------------------------------------------------------

export interface BuildStaircaseInput {
  chatId: string
  steps: TrajectoryStep[]
  model?: string
  summarize?: Summarize
  /** Overrides (all optional; sensible defaults derived from env/model). */
  config?: Partial<StaircaseConfig>
}

export interface BuildStaircaseResult {
  /** The assembled staircase string, or null if not applicable / disabled. */
  text: string | null
  /** Number of filtered steps. */
  filteredCount: number
  /** Resolved raw-tail size. */
  rawTail: number
  /** Number of summary segments emitted. */
  segments: number
}

/** Read the kill switch. Default ON in logic; the WIRING is gated separately. */
export function isStaircaseEnabled(): boolean {
  return process.env.CODY_CONTEXT_STAIRCASE !== '0'
}

/**
 * Resolve a full StaircaseConfig from partial overrides + env + model. Pure
 * (reads process.env, but no I/O).
 */
export function resolveConfig(input: BuildStaircaseInput): StaircaseConfig {
  const c = input.config || {}
  const fanout = c.fanout && c.fanout > 1 ? Math.floor(c.fanout) : DEFAULT_FANOUT
  const contextWindow = c.contextWindow && c.contextWindow > 0 ? c.contextWindow : resolveModelWindow(input.model)
  const contextFraction = typeof c.contextFraction === 'number' && c.contextFraction > 0 ? c.contextFraction : DEFAULT_CONTEXT_FRACTION
  const budgetCap = c.budgetCap && c.budgetCap > 0 ? c.budgetCap : DEFAULT_BUDGET_CAP
  return {
    fanout,
    contextWindow,
    contextFraction,
    budgetCap,
    budget: c.budget,
    rawTail: c.rawTail,
    startIndex: c.startIndex ?? 0,
  }
}

/**
 * Build the token-budgeted staircase for a resuming/continuing build.
 *
 * Bounded + fail-open: returns { text: null } (never throws) when disabled, when
 * there is too little history to bother (the raw tail already shows everything),
 * or on any internal failure — the caller then uses the linear window unchanged.
 *
 * The summarizer is the ONLY I/O; inject a bounded one. When omitted, no
 * sealing happens and assembly uses whatever blocks are already cached (still
 * useful on a warm cache; harmless cold).
 */
export async function buildStaircase(input: BuildStaircaseInput): Promise<BuildStaircaseResult> {
  const empty: BuildStaircaseResult = { text: null, filteredCount: 0, rawTail: 0, segments: 0 }
  try {
    if (!isStaircaseEnabled()) return empty
    const cfg = resolveConfig(input)
    const filtered = filterSteps(input.steps || [])
    const n = filtered.length
    if (n === 0) return empty

    const r = resolveRawTail(n, cfg)
    // Nothing older than the raw tail → the linear window already shows it all;
    // don't spend an LLM call or emit a redundant staircase.
    if (n <= r) return { ...empty, filteredCount: n, rawTail: r }

    const start = snapStartIndex(cfg.startIndex, cfg.fanout)

    if (input.summarize) {
      await sealFrontier(input.chatId, filtered, start, cfg.fanout, input.summarize)
    }

    const text = assembleStaircase(input.chatId, filtered, r, cfg.fanout, start)
    const segments = decomposeStaircase(computeCut0(n, r, cfg.fanout), cfg.fanout).length
    return { text, filteredCount: n, rawTail: r, segments }
  } catch {
    return empty
  }
}

// ---------------------------------------------------------------------------
// Default bounded summarizer (the real I/O — completeText)
// ---------------------------------------------------------------------------

const ROLLUP_SYSTEM = `You are Cody, the agent whose build log this is. Summarize this one slice of your OWN build history in the FIRST PERSON — say "I", never "the agent". The input is a chronological list of lines: either raw steps "[turn] kind: content", or child rollup summaries (already first person). Reply with ONLY a JSON object, no markdown fences:
{"summary": "2-3 first-person sentences: what I built, decided, and how it went",
 "themes": ["1-4 short kebab-case topics"],
 "step_ids": ["up to 4 of the most important step numbers that literally appear in the input"]}`

/** Cap on summarizer output tokens — bounded, cheap. */
export const ROLLUP_MAX_TOKENS = 512

/**
 * The default summarizer: a bounded `completeText` call. Isolated here so the
 * pure logic above never imports the LLM path. Fails soft — a bad/absent
 * provider throws, which sealFrontier catches per-block (fail-open).
 */
export function defaultSummarize(): Summarize {
  return async ({ text }) => {
    // Lazy import: keep the LLM dependency off the pure logic + test path.
    const { completeText } = await import('@/lib/build/claude-completion')
    const res = await completeText({
      system: ROLLUP_SYSTEM,
      user: text,
      maxTokens: ROLLUP_MAX_TOKENS,
      temperature: 0.3,
    })
    return parseSummary(res.text)
  }
}

/**
 * Tolerant parse of the summarizer's JSON reply (strips fences, salvages the
 * first object). Pure. Returns a valid body; on total failure, an empty one
 * (the caller substitutes fallback anchor ids).
 */
export function parseSummary(raw: string): { summary: string; themes: string[]; stepIds: string[] } {
  const fallback = { summary: '', themes: [] as string[], stepIds: [] as string[] }
  if (!raw) return fallback
  let s = raw.trim()
  // Strip ```json fences if present.
  s = s.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '').trim()
  // Salvage the first {...} object.
  const first = s.indexOf('{')
  const last = s.lastIndexOf('}')
  if (first >= 0 && last > first) s = s.slice(first, last + 1)
  try {
    const obj = JSON.parse(s)
    return {
      summary: typeof obj.summary === 'string' ? obj.summary.trim() : '',
      themes: Array.isArray(obj.themes) ? obj.themes.slice(0, 4).map(String) : [],
      stepIds: Array.isArray(obj.step_ids)
        ? obj.step_ids.slice(0, 4).map(String)
        : Array.isArray(obj.stepIds)
          ? obj.stepIds.slice(0, 4).map(String)
          : [],
    }
  } catch {
    return fallback
  }
}

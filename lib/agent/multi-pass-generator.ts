/**
 * Multi-Pass Generator
 *
 * Executes a chunk plan by generating each phase sequentially,
 * calling LLM API (Meta Llama or AINative) for each phase.
 */

import OpenAI from 'openai'
import { ChunkPlan, ChunkPhase } from './chunk-planner'
import { extractComponentCode } from './component-generation-tool'
import { validateGeneratedCode } from '../code-validator'
import { PROFESSIONAL_SYSTEM_PROMPT } from '../professional-prompt'
import { recallPastPerformance, storeGenerationMemory } from './zeromemory'
import {
  createGenerationBudget,
  recordCall,
  checkBudget,
  budgetStopMessage,
  type GenerationBudget,
} from '../build/generation-budget'

export interface GeneratedChunk {
  chunkId: string
  phase: 1 | 2 | 3
  phaseType: 'core' | 'feature' | 'integration'
  code: string
  rawResponse: string
  tokenUsage: {
    input: number
    output: number
    total: number
  }
  success: boolean
  validationPassed: boolean
  error?: string
  /**
   * True when the failure is rate-limit/overload shaped (a 429/5xx status,
   * OR a client-side request timeout against an overloaded provider) — see
   * isRateLimitedError below. False for a content/validation failure.
   *
   * Deliberately a boolean, not the raw status code: a timeout-shaped
   * failure (APIUserAbortError) has `.status === undefined` BY
   * CONSTRUCTION even though it IS rate-limit shaped — storing the raw
   * status here previously made that case indistinguishable from "not
   * rate-limited" downstream (both ended up `undefined`), silently
   * defeating the fallback-model retry for exactly the timeout case it was
   * most needed for (found live, 2026-11-04: Phase 1 timed out identically
   * on both the original attempt and its retry, every single time).
   */
  isRateLimited?: boolean
  generationTime: number
}

export interface ProgressCallback {
  (phase: number, totalPhases: number, message: string, data?: any): void
}

/**
 * Real per-phase output ceiling passed to the LLM (the `max_tokens` below).
 * Exported and used by BOTH the API call and the #1192 cost pre-flight check,
 * so the budget's worst-case estimate can never drift from what is actually
 * requested — the bug class where a cap is computed against a stale ceiling.
 */
export const CHUNK_MAX_TOKENS = 16000

/**
 * Condensed system prompt used ONLY when retrying a phase against a
 * fallback model (issue #1802/#1804/#1808 follow-up).
 *
 * Real bug, found live (2026-11-04): after the rate-limit/timeout fallback
 * fix landed, every fallback-model retry STILL failed — "Phase N failed
 * after retry" for every single phase, with Phase 1 now succeeding (the
 * timeout fix worked) but every subsequent phase's ministral-14b retry
 * failing too. Root cause: `generateChunk`'s system prompt is
 * `PROFESSIONAL_SYSTEM_PROMPT.split('## FEW-SHOT EXAMPLES')[0] +
 * phaseGuidance + codingStandards` — but the string `'## FEW-SHOT
 * EXAMPLES'` does not exist anywhere in professional-prompt.ts (confirmed:
 * `.indexOf()` returns -1), so `.split(...)[0]` is a no-op that returns the
 * ENTIRE ~52KB (~13,000-token) prompt unchanged. ministral-14b's context
 * window is ~4K tokens (already documented in app/api/chat-ws/route.ts's
 * own condensing comment for its single-pass path) — the system prompt
 * alone overflows it before any phase content is even considered, so a
 * fallback retry to ministral-14b was mathematically guaranteed to fail
 * every time, defeating the whole point of the fallback.
 *
 * Mirrors the proven condensed-prompt pattern already used by chat-ws's
 * single-pass fallback path, trimmed to the essentials a small-context
 * model can actually act on: output structure, the core DB-persistence
 * pattern, and the "must be interactive" rule — intentionally far shorter
 * than PROFESSIONAL_SYSTEM_PROMPT.
 */
const FALLBACK_MODEL_SYSTEM_PROMPT = `Generate a complete, production-ready React component.

STRUCTURE:
\`\`\`jsx
import React, { useState } from 'react'
export default function App() {
  const [state, setState] = useState(initialValue)
  return (
    <div className="min-h-screen bg-white">
      {/* Full UI here */}
    </div>
  )
}
\`\`\`

RULES:
- Mobile-first responsive: w-full max-w-* mx-auto px-4, flex-col md:flex-row, grid-cols-1 sm:grid-cols-2
- Every button needs a real onClick with a useState handler — no dead buttons
- For persisted data: fetch('/api/db/{table}') to list (returns { data: [...] }), POST to insert, PUT/DELETE with ?id=ID to update/remove. Never localStorage, never a real backend/DB package.
- Import icons from 'lucide-react' only
- export default function App()
- Return ONLY the code wrapped in \`\`\`jsx and \`\`\` markers
`

/**
 * Issue #1299: this per-phase call had no timeout/AbortSignal at all, unlike
 * the primary Claude call (#1253/#1259) it's a sibling of on the live
 * chunked-generation path (executeChunkPlan/executeChunkPlanWithBudget, wired
 * into app/api/chat-ws's multi-pass generation). A hung upstream response
 * here stalled a phase indefinitely with no error surfaced. Sized to match
 * PRIMARY_CLAUDE_TIMEOUT_MS's default (120s) since this call shares the same
 * CHUNK_MAX_TOKENS=16000 output ceiling.
 */
const CHUNK_GENERATION_TIMEOUT_MS = Number(process.env.CHUNK_GENERATION_TIMEOUT_MS || 120_000)

/**
 * Rough prompt-size estimate for the pre-flight cost check (~4 chars/token,
 * the standard approximation this repo already uses in
 * lib/services/token-counter.service.ts). Only the worst-case OUTPUT cost
 * needs to be exact for the cap to hold; input is the smaller term and a real
 * count is recorded from the provider's own `usage` after the call.
 */
function estimatePromptTokens(prompt: string): number {
  return Math.ceil(String(prompt || '').length / 4)
}

export interface ExecuteChunkPlanOptions {
  /**
   * Per-generation cost cap (#1192). Omit to use the configured default
   * (GENERATION_BUDGET_USD / the tier table). Pass an explicit budget to share
   * ONE cap across this loop and any other calls the same founder request
   * makes.
   */
  budget?: GenerationBudget
  /** Plan tier, used to pick the cap when `budget` is omitted. */
  tier?: string
  /**
   * Model(s) to retry a failed phase with when the failure is rate-limit
   * shaped (issue #1802/#1804). Real incident, found live 2026-11-04: a
   * Bedrock daily-token-quota 429 hit EVERY phase of a multi-pass e-commerce
   * product generation — the existing single retry re-called the SAME
   * (client, modelId) pair, so the retry 429d identically every time (0
   * successful phases, "build failed"). When the first attempt's error is a
   * 429 (or a 5xx from the same overloaded backend) and fallbackModels is
   * non-empty, the retry uses the first entry here instead of the original
   * model — a genuinely different model/provider that doesn't share the same
   * quota. Omit (or pass []) to keep the prior same-model retry behavior.
   */
  fallbackModels?: string[]
}

/**
 * Coerce a chat-completion message's `content` to a plain string.
 *
 * Real bug, found live (2026-11-04): two concurrent founder generations
 * failed Phase 1 with "content.match is not a function" (confirmed via a
 * direct repro against the real validateGeneratedCode()). `content` was
 * typed/assumed to always be a string (`response.choices?.[0]?.message
 * ?.content || ''`), but some OpenAI-compatible providers return it as an
 * ARRAY of content blocks (`[{type:'text', text:'...'}]`, the same shape
 * OpenAI's own multi-modal responses use) instead of a plain string for
 * certain models/response shapes — an array has no .match/.replace, so
 * validateGeneratedCode() -> extractCodeFromMarkdown() threw immediately on
 * a response that actually contained perfectly usable generated code.
 */
function coerceMessageContentToString(content: unknown): string {
  if (typeof content === 'string') return content
  if (Array.isArray(content)) {
    return content
      .map((block) => (block && typeof block === 'object' && typeof (block as any).text === 'string' ? (block as any).text : ''))
      .join('')
  }
  return ''
}

/**
 * True for a rate-limit/overload-shaped failure — a 429/5xx (matches
 * lib/utils/retry.ts's isRetryableError), OR a client-side request timeout
 * (AbortSignal firing before the provider ever responded).
 *
 * Real incident, found live (2026-11-04): Phase 1 of multi-pass chunking
 * consistently failed in 94.7s-119.8s — right at CHUNK_GENERATION_TIMEOUT_MS
 * (120s) — with "Request was aborted." (the OpenAI SDK's
 * APIUserAbortError, whose .status is always `undefined` by construction,
 * never a numeric code). Because Phase 1 must succeed for mergeChunks() to
 * produce anything at all ("Core structure (Phase 1) failed or is missing
 * - cannot merge"), and the SAME retry against the SAME overloaded
 * model/provider timed out identically every time, this silently killed
 * the entire generation even after the 429-specific fallback (above) was
 * already fixed — a request that hangs until the client gives up is the
 * same underlying overload/backpressure as a clean 429, just without the
 * clean status code to detect it by. Treated the same way: switch to a
 * fallback model on retry instead of hammering the identical timeout again.
 */
function isRateLimitedError(error: unknown): boolean {
  if (error && typeof error === 'object' && 'status' in error) {
    const status = (error as { status: unknown }).status
    if (status === 429 || status === 502 || status === 503 || status === 504) return true
  }
  if (
    error instanceof Error &&
    (error as { status?: unknown }).status === undefined &&
    /request was aborted/i.test(error.message)
  ) {
    return true
  }
  return false
}

export interface ChunkPlanResult {
  chunks: GeneratedChunk[]
  /** Final accumulated spend for this generation. */
  budget: GenerationBudget
  /** Set when the loop was stopped early by the cost cap. */
  budgetStop?: ReturnType<typeof budgetStopMessage>
}

/**
 * Execute a chunk plan by generating each phase.
 *
 * #1192: this loop is the real runaway path — N phases at max_tokens 16000
 * each, PLUS one retry per failed phase, so up to 2N full-size billed calls
 * with (previously) no spend check between iterations. Every call now goes
 * through the shared GenerationBudget, and the loop stops BEFORE a call that
 * would cross the cap rather than discovering the overspend afterwards.
 *
 * Returns the chunks generated so far alongside the final budget; a
 * cost-stopped run returns its PARTIAL chunks (not an empty array), so the
 * founder keeps whatever really did get built.
 */
export async function executeChunkPlanWithBudget(
  plan: ChunkPlan,
  client: OpenAI,
  modelId: string,
  onProgress: ProgressCallback,
  chatId?: string,
  options: ExecuteChunkPlanOptions = {},
): Promise<ChunkPlanResult> {
  const chunks: GeneratedChunk[] = []
  const totalPhases = plan.phases.length
  let budget = options.budget
    ?? createGenerationBudget({ model: modelId, tier: options.tier })

  // Recall past performance for similar prompts (Refs #43)
  const firstPrompt = plan.phases[0]?.prompt || ''
  const pastLearnings = await recallPastPerformance(firstPrompt)
  if (pastLearnings) {
    // Inject past learnings into phase 1 prompt so the LLM benefits
    plan.phases[0].prompt = `Past learnings for similar requests:\n${pastLearnings}\n\n${plan.phases[0].prompt}`
  }

  onProgress(0, totalPhases, 'Starting multi-phase generation...')

  let budgetStop: ReturnType<typeof budgetStopMessage> | undefined

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i]
    const phaseNum = i + 1

    // #1192: pre-flight cost check at the loop boundary. Charged at this
    // phase's WORST CASE (the real max_tokens generateChunk uses), so a phase
    // allowed here can never push spend past the cap.
    const gate = checkBudget(budget, {
      maxOutputTokens: CHUNK_MAX_TOKENS,
      estimatedInputTokens: estimatePromptTokens(phase.prompt),
    })
    budget = gate.budget
    if (!gate.allowed) {
      budgetStop = budgetStopMessage(budget)
      onProgress(phaseNum, totalPhases, budgetStop.message, {
        budgetExceeded: true,
        spentUsd: budget.spentUsd,
        limitUsd: budget.limitUsd,
        phasesCompleted: chunks.length,
        phasesPlanned: totalPhases,
      })
      console.warn(
        `🛑 [#1192] Multi-pass generation stopped by cost cap after ${chunks.length}/${totalPhases} phases: ` +
        `spent $${budget.spentUsd.toFixed(4)} of $${budget.limitUsd.toFixed(2)} limit`,
      )
      break
    }

    onProgress(phaseNum, totalPhases, `Generating ${phase.description}...`, {
      chunkId: phase.chunkId,
      targetTokens: phase.targetTokens
    })

    try {
      const chunk = await generateChunk(phase, client, modelId, phaseNum, totalPhases, onProgress)
      chunks.push(chunk)
      budget = recordCall(budget, {
        inputTokens: chunk.tokenUsage.input,
        outputTokens: chunk.tokenUsage.output,
      })

      if (!chunk.success) {
        onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed: ${chunk.error}`, {
          error: chunk.error
        })

        // #1813: a SINGLE fallback model is not resilient enough on its own
        // — confirmed live, 2026-11-04: after #1812 fixed STANDARD_FALLBACKS'
        // ordering (ministral-14b no longer first), TWO separate real
        // generations ("Mossgrove", "Copperfield") still failed ALL 6
        // phases, every single time, because the NEW first fallback
        // (qwen-coder-32b) itself returned "503 status code (no body)" on
        // every attempt — a different model, same single-point-of-failure
        // shape. Rather than chase whichever specific model is unreliable
        // THIS hour (confirmed unproductive twice now), the retry loop
        // itself tries EACH remaining fallback model in sequence — stopping
        // at the first success, or when the list and/or budget is
        // exhausted — so no single model's outage can defeat generation on
        // its own. A content/validation failure (not rate-limit shaped)
        // still retries the ORIGINAL model exactly once, unchanged from
        // prior behavior — only a rate-limit/overload-shaped failure
        // triggers the fallback rotation.
        const rateLimited = chunk.isRateLimited
        const candidateModels = rateLimited && options.fallbackModels?.length
          ? options.fallbackModels
          : [modelId] // non-rate-limited failure: exactly one retry, same model (prior behavior)

        let retryChunk: GeneratedChunk | undefined
        for (const retryModel of candidateModels) {
          const retryGate = checkBudget(budget, {
            maxOutputTokens: CHUNK_MAX_TOKENS,
            estimatedInputTokens: estimatePromptTokens(phase.prompt),
          })
          budget = retryGate.budget
          if (!retryGate.allowed) {
            budgetStop = budgetStopMessage(budget)
            onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed; retry skipped — ${budgetStop.message}`, {
              budgetExceeded: true,
              spentUsd: budget.spentUsd,
              limitUsd: budget.limitUsd,
            })
            break
          }

          onProgress(
            phaseNum, totalPhases,
            retryModel !== modelId
              ? `Retrying phase ${phaseNum} with fallback model ${retryModel} (primary rate-limited)...`
              : `Retrying phase ${phaseNum}...`,
          )
          const attempt = await generateChunk(phase, client, retryModel, phaseNum, totalPhases, onProgress, retryModel !== modelId)
          budget = recordCall(budget, {
            inputTokens: attempt.tokenUsage.input,
            outputTokens: attempt.tokenUsage.output,
          })
          retryChunk = attempt

          if (attempt.success) break
          // #1802/#1804/#1808 follow-up: surface WHY each attempt failed —
          // previously every retry failure looked identical in logs, with
          // no way to tell a rate-limit from a fallback model choking on a
          // too-large prompt from a genuine content/validation problem.
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} attempt with ${retryModel} failed: ${attempt.error}`, {
            error: attempt.error,
          })
          // Only keep trying the NEXT fallback model if this failure was
          // itself rate-limit shaped — a genuine content/validation failure
          // from a fallback model wouldn't be fixed by trying yet another one.
          if (!attempt.isRateLimited) break
        }

        if (retryChunk?.success) {
          chunks[chunks.length - 1] = retryChunk
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} succeeded on retry`)
        } else if (retryChunk) {
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed after retry: ${retryChunk.error}`, {
            error: retryChunk.error,
          })
        }
      } else {
        onProgress(phaseNum, totalPhases, `Phase ${phaseNum} completed successfully`, {
          tokenUsage: chunk.tokenUsage,
          codeLength: chunk.code.length
        })
      }

    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : String(error)
      onProgress(phaseNum, totalPhases, `Phase ${phaseNum} error: ${errorMsg}`)

      chunks.push({
        chunkId: phase.chunkId,
        phase: phase.phaseNumber,
        phaseType: phase.phaseType,
        code: '',
        rawResponse: '',
        tokenUsage: { input: 0, output: 0, total: 0 },
        success: false,
        validationPassed: false,
        error: errorMsg,
        generationTime: 0
      })
    }
  }

  // Honest completion message: a cost-stopped run did NOT complete all phases,
  // and must not claim it did.
  onProgress(
    totalPhases,
    totalPhases,
    budgetStop
      ? `Stopped after ${chunks.length} of ${totalPhases} phases — cost limit reached`
      : 'All phases completed',
    {
      successCount: chunks.filter(c => c.success).length,
      totalChunks: chunks.length,
      ...(budgetStop ? { budgetExceeded: true, spentUsd: budget.spentUsd, limitUsd: budget.limitUsd } : {}),
    },
  )

  // Store generation result for cross-product learning (Refs #43)
  const successCount = chunks.filter(c => c.success).length
  // A budget-stopped run is NOT a success even if every phase it ran passed —
  // recording it as one would teach the learning loop the wrong lesson.
  const allSuccess = !budgetStop && successCount === chunks.length
  const quality = chunks.length > 0 ? successCount / chunks.length : 0
  storeGenerationMemory(firstPrompt.slice(0, 300), allSuccess, quality, {
    source: 'multi-pass-generator',
    totalPhases: chunks.length,
    successCount,
    ...(budgetStop ? { stoppedByCostCap: true } : {}),
  }, chatId).catch(() => {})

  return { chunks, budget, budgetStop }
}

/**
 * Backward-compatible wrapper — returns just the chunks, as this function has
 * always done. The cost cap (#1192) still applies: callers that want to SEE the
 * accumulated spend or the stop reason should call executeChunkPlanWithBudget.
 */
export async function executeChunkPlan(
  plan: ChunkPlan,
  client: OpenAI,
  modelId: string,
  onProgress: ProgressCallback,
  chatId?: string,
  options: ExecuteChunkPlanOptions = {},
): Promise<GeneratedChunk[]> {
  const result = await executeChunkPlanWithBudget(plan, client, modelId, onProgress, chatId, options)
  return result.chunks
}

/**
 * Generate a single chunk (one phase) using OpenAI-compatible API
 */
async function generateChunk(
  phase: ChunkPhase,
  client: OpenAI,
  modelId: string,
  phaseNum: number,
  totalPhases: number,
  onProgress: ProgressCallback,
  /** True when `modelId` is a fallback model (not the original primary
   *  model) — uses FALLBACK_MODEL_SYSTEM_PROMPT instead of the full
   *  ~13,000-token PROFESSIONAL_SYSTEM_PROMPT, which overflows a
   *  small-context fallback model's window before any phase content is
   *  even considered (see FALLBACK_MODEL_SYSTEM_PROMPT's doc comment). */
  isFallbackModel = false,
): Promise<GeneratedChunk> {
  const startTime = Date.now()

  try {
    const phaseGuidance = phase.phaseType === 'core' ? `

## MULTI-PHASE GENERATION - PHASE 1 (CORE STRUCTURE)

YOUR ROLE IN THIS PHASE:
- Focus on architecture, routing, and foundational setup
- Create placeholder pages (they'll be implemented in Phase 2)
- Define ALL TypeScript types and interfaces
- Set up mock data generators
- Establish global state management (if needed)
- DO NOT implement full page content yet - placeholders only!

DEPENDENCIES: ${phase.dependencies.length > 0 ? phase.dependencies.join(', ') : 'None (first phase)'}
` : phase.phaseType === 'feature' ? `

## MULTI-PHASE GENERATION - PHASE ${phase.phaseNumber} (FEATURE IMPLEMENTATION)

YOUR ROLE IN THIS PHASE:
- Implement the specific pages listed in the prompt
- Use existing types and mock data from Phase 1
- Make pages fully functional with real interactivity
- Focus ONLY on pages assigned to this chunk

DEPENDENCIES: ${phase.dependencies.join(', ')}
` : `

## MULTI-PHASE GENERATION - PHASE ${phase.phaseNumber} (INTEGRATION)

YOUR ROLE IN THIS PHASE:
- Connect modules together seamlessly
- Add cross-module navigation and links
- Implement shared features and state
- Add error handling and loading states
- Apply final polish (responsive, accessibility)

DEPENDENCIES: ${phase.dependencies.join(', ')}
`

    const codingStandards = `

## CODING STANDARDS (MANDATORY)
- NEVER hardcode API keys, secrets, or credentials
- Use semantic HTML elements (header, nav, main, article, etc.)
- Include ARIA labels on interactive elements
- Ensure keyboard navigation works
- Use descriptive variable names (camelCase)
- Handle errors gracefully with try/catch
- For content strings with apostrophes (contractions like "it's", "you're"), use double quotes or escape the apostrophe (\\') so they don't end the string early and break the syntax
- Return ONLY the code wrapped in \`\`\`jsx and \`\`\` markers.
`

    const basePrompt = isFallbackModel ? FALLBACK_MODEL_SYSTEM_PROMPT : PROFESSIONAL_SYSTEM_PROMPT
    const systemPrompt = basePrompt + phaseGuidance + codingStandards

    onProgress(phaseNum, totalPhases, `Calling LLM API for phase ${phaseNum}...`)

    const response = await client.chat.completions.create(
      {
        model: modelId,
        // Shared with the #1192 cost pre-flight check so the two can never drift.
        max_tokens: CHUNK_MAX_TOKENS,
        temperature: 0.7,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: phase.prompt }
        ],
      },
      { signal: AbortSignal.timeout(CHUNK_GENERATION_TIMEOUT_MS) },
    )

    const rawResponse = coerceMessageContentToString(response.choices?.[0]?.message?.content)
    const tokenUsage = {
      input: response.usage?.prompt_tokens || 0,
      output: response.usage?.completion_tokens || 0,
      total: response.usage?.total_tokens || 0
    }

    onProgress(phaseNum, totalPhases, `Extracting and validating code for phase ${phaseNum}...`, {
      outputTokens: tokenUsage.output
    })

    // Validate code (auto-fixes are applied internally)
    const validation = validateGeneratedCode(rawResponse)
    const code = validation.code
    const validationPassed = validation.valid

    if (!validationPassed) {
      throw new Error(`Validation failed: ${validation.error}`)
    }

    const generationTime = Date.now() - startTime

    return {
      chunkId: phase.chunkId,
      phase: phase.phaseNumber,
      phaseType: phase.phaseType,
      code,
      rawResponse,
      tokenUsage,
      success: true,
      validationPassed,
      generationTime
    }

  } catch (error) {
    const generationTime = Date.now() - startTime
    const errorMsg = error instanceof Error ? error.message : String(error)

    return {
      chunkId: phase.chunkId,
      phase: phase.phaseNumber,
      phaseType: phase.phaseType,
      code: '',
      rawResponse: '',
      tokenUsage: { input: 0, output: 0, total: 0 },
      success: false,
      validationPassed: false,
      error: errorMsg,
      isRateLimited: isRateLimitedError(error),
      generationTime
    }
  }
}

/**
 * Get summary of chunk generation results
 */
export function getGenerationSummary(chunks: GeneratedChunk[]): string {
  const successful = chunks.filter(c => c.success)
  const failed = chunks.filter(c => !c.success)
  const totalTokens = chunks.reduce((sum, c) => sum + c.tokenUsage.total, 0)
  const totalTime = chunks.reduce((sum, c) => sum + c.generationTime, 0)

  const lines: string[] = []
  lines.push(`📊 Generation Summary:`)
  lines.push(`   Total Phases: ${chunks.length}`)
  lines.push(`   Successful: ${successful.length}`)
  lines.push(`   Failed: ${failed.length}`)
  lines.push(`   Total Tokens: ${totalTokens.toLocaleString()}`)
  lines.push(`   Total Time: ${(totalTime / 1000).toFixed(1)}s`)
  lines.push(``)

  chunks.forEach((chunk, i) => {
    const status = chunk.success ? '✅' : '❌'
    const tokens = chunk.tokenUsage.output.toLocaleString()
    const time = (chunk.generationTime / 1000).toFixed(1)
    lines.push(`${status} Phase ${i + 1}: ${tokens} tokens in ${time}s`)
  })

  if (failed.length > 0) {
    lines.push(``)
    lines.push(`⚠️  Failed Phases:`)
    failed.forEach(chunk => {
      lines.push(`   - ${chunk.chunkId}: ${chunk.error}`)
    })
  }

  return lines.join('\n')
}

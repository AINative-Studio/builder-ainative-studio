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

        // Try one retry on failure — but the retry is a REAL billed call, so it
        // goes through the same cap. Previously a failing phase could double
        // its own spend with no check at all.
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

        onProgress(phaseNum, totalPhases, `Retrying phase ${phaseNum}...`)
        const retryChunk = await generateChunk(phase, client, modelId, phaseNum, totalPhases, onProgress)
        budget = recordCall(budget, {
          inputTokens: retryChunk.tokenUsage.input,
          outputTokens: retryChunk.tokenUsage.output,
        })

        if (retryChunk.success) {
          chunks[chunks.length - 1] = retryChunk
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} succeeded on retry`)
        } else {
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed after retry`)
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
  onProgress: ProgressCallback
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

    const systemPrompt = PROFESSIONAL_SYSTEM_PROMPT.split('## FEW-SHOT EXAMPLES')[0] + phaseGuidance + codingStandards

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

    const rawResponse = response.choices?.[0]?.message?.content || ''
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

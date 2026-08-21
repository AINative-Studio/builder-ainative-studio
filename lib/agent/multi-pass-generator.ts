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
 * Execute a chunk plan by generating each phase
 */
export async function executeChunkPlan(
  plan: ChunkPlan,
  client: OpenAI,
  modelId: string,
  onProgress: ProgressCallback
): Promise<GeneratedChunk[]> {
  const chunks: GeneratedChunk[] = []
  const totalPhases = plan.phases.length

  // Recall past performance for similar prompts (Refs #43)
  const firstPrompt = plan.phases[0]?.prompt || ''
  const pastLearnings = await recallPastPerformance(firstPrompt)
  if (pastLearnings) {
    // Inject past learnings into phase 1 prompt so the LLM benefits
    plan.phases[0].prompt = `Past learnings for similar requests:\n${pastLearnings}\n\n${plan.phases[0].prompt}`
  }

  onProgress(0, totalPhases, 'Starting multi-phase generation...')

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i]
    const phaseNum = i + 1

    onProgress(phaseNum, totalPhases, `Generating ${phase.description}...`, {
      chunkId: phase.chunkId,
      targetTokens: phase.targetTokens
    })

    try {
      const chunk = await generateChunk(phase, client, modelId, phaseNum, totalPhases, onProgress)
      chunks.push(chunk)

      if (!chunk.success) {
        onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed: ${chunk.error}`, {
          error: chunk.error
        })

        // Try one retry on failure
        onProgress(phaseNum, totalPhases, `Retrying phase ${phaseNum}...`)
        const retryChunk = await generateChunk(phase, client, modelId, phaseNum, totalPhases, onProgress)

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

  onProgress(totalPhases, totalPhases, 'All phases completed', {
    successCount: chunks.filter(c => c.success).length,
    totalChunks: chunks.length
  })

  // Store generation result for cross-product learning (Refs #43)
  const successCount = chunks.filter(c => c.success).length
  const allSuccess = successCount === chunks.length
  const quality = chunks.length > 0 ? successCount / chunks.length : 0
  storeGenerationMemory(firstPrompt.slice(0, 300), allSuccess, quality, {
    source: 'multi-pass-generator',
    totalPhases: chunks.length,
    successCount,
  }).catch(() => {})

  return chunks
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

    const response = await client.chat.completions.create({
      model: modelId,
      max_tokens: 16000,
      temperature: 0.7,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: phase.prompt }
      ],
    })

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

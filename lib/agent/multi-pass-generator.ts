/**
 * Multi-Pass Generator
 *
 * Executes a chunk plan by generating each phase sequentially,
 * calling Claude API for each phase and managing the workflow.
 */

import Anthropic from '@anthropic-ai/sdk'
import { ChunkPlan, ChunkPhase } from './chunk-planner'
import { extractComponentCode } from './component-generation-tool'
import { validateGeneratedCode } from '../code-validator'
import { PROFESSIONAL_SYSTEM_PROMPT } from '../professional-prompt'

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
  anthropic: Anthropic,
  onProgress: ProgressCallback
): Promise<GeneratedChunk[]> {
  const chunks: GeneratedChunk[] = []
  const totalPhases = plan.phases.length

  onProgress(0, totalPhases, 'Starting multi-phase generation...')

  for (let i = 0; i < plan.phases.length; i++) {
    const phase = plan.phases[i]
    const phaseNum = i + 1

    onProgress(phaseNum, totalPhases, `Generating ${phase.description}...`, {
      chunkId: phase.chunkId,
      targetTokens: phase.targetTokens
    })

    try {
      const chunk = await generateChunk(phase, anthropic, phaseNum, totalPhases, onProgress)
      chunks.push(chunk)

      if (!chunk.success) {
        onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed: ${chunk.error}`, {
          error: chunk.error
        })

        // Try one retry on failure
        onProgress(phaseNum, totalPhases, `Retrying phase ${phaseNum}...`)
        const retryChunk = await generateChunk(phase, anthropic, phaseNum, totalPhases, onProgress)

        if (retryChunk.success) {
          chunks[chunks.length - 1] = retryChunk
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} succeeded on retry`)
        } else {
          onProgress(phaseNum, totalPhases, `Phase ${phaseNum} failed after retry`)
          // Continue with other phases even if one fails
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

      // Add failed chunk to results
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

  return chunks
}

/**
 * Generate a single chunk (one phase)
 */
async function generateChunk(
  phase: ChunkPhase,
  anthropic: Anthropic,
  phaseNum: number,
  totalPhases: number,
  onProgress: ProgressCallback
): Promise<GeneratedChunk> {
  const startTime = Date.now()

  try {
    // Enhanced system prompt for chunked generation
    // Start with comprehensive professional prompt (includes all design standards, syntax rules, etc.)
    const phaseGuidance = phase.phaseType === 'core' ? `

## MULTI-PHASE GENERATION - PHASE 1 (CORE STRUCTURE)

**CRITICAL: This is Phase 1 of a multi-phase generation process**

YOUR ROLE IN THIS PHASE:
- Focus on architecture, routing, and foundational setup
- Create placeholder pages (they'll be implemented in Phase 2)
- Define ALL TypeScript types and interfaces
- Set up mock data generators
- Establish global state management (if needed)
- Create shared component library (Button, Card, etc. - already available globally)
- DO NOT implement full page content yet - placeholders only!

DELIVERABLES:
- Root layout with navigation structure
- Routing configuration for all pages
- Type definitions (TypeScript interfaces)
- Mock data generators with realistic data
- Placeholder page components (just structure, no content)

DEPENDENCIES: ${phase.dependencies.length > 0 ? phase.dependencies.join(', ') : 'None (first phase)'}
` : phase.phaseType === 'feature' ? `

## MULTI-PHASE GENERATION - PHASE ${phase.phaseNumber} (FEATURE IMPLEMENTATION)

**CRITICAL: This is a feature implementation phase in a multi-phase process**

CONTEXT FROM PREVIOUS PHASES:
- Core structure exists from Phase 1 (types, routing, mock data)
- Other features may have been generated in parallel
- You are implementing ONLY the pages assigned to this chunk

YOUR ROLE IN THIS PHASE:
- Implement the specific pages listed in the prompt
- Use existing types and mock data from Phase 1
- Make pages fully functional with real interactivity
- Focus ONLY on pages assigned to this chunk
- Maintain consistency with design system and standards

AVAILABLE FROM PHASE 1:
- TypeScript type definitions
- Mock data generators
- Routing structure
- Global UI components

DEPENDENCIES: ${phase.dependencies.join(', ')}
` : `

## MULTI-PHASE GENERATION - PHASE ${phase.phaseNumber} (INTEGRATION)

**CRITICAL: This is the final integration phase**

CONTEXT:
- All features have been generated in previous phases
- Core structure and individual pages exist
- Your job is to tie everything together

YOUR ROLE IN THIS PHASE:
- Connect modules together seamlessly
- Add cross-module navigation and links
- Implement shared features and state
- Add error handling and loading states
- Apply final polish (responsive, accessibility, etc.)
- Ensure consistent design across all pages

DEPENDENCIES: ${phase.dependencies.join(', ')}
`

    // Add coding standards enforcement (security & accessibility)
    const codingStandards = `

## CODING STANDARDS (MANDATORY)

### Security Requirements
- NEVER hardcode API keys, secrets, or credentials
- NEVER log sensitive data (passwords, tokens, PII)
- ALWAYS validate and sanitize user inputs
- Use environment variables for configuration
- Implement proper error boundaries

### Accessibility Requirements (WCAG AA)
- Use semantic HTML elements (header, nav, main, article, etc.)
- Include ARIA labels on interactive elements
- Ensure keyboard navigation works (Tab, Enter, Escape)
- Maintain color contrast ratios (4.5:1 for text)
- Add alt text to all images
- Support screen readers

### Code Quality
- Use descriptive variable names (camelCase)
- Add TypeScript types for all functions
- Handle errors gracefully with try/catch
- Keep functions focused and under 50 lines
- NO console.log in production code (use proper error handling)
`

    const systemPrompt = PROFESSIONAL_SYSTEM_PROMPT + phaseGuidance + codingStandards

    onProgress(phaseNum, totalPhases, `Calling Claude API for phase ${phaseNum}...`)

    // Call Claude API with streaming
    const stream = await anthropic.messages.stream({
      model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
      max_tokens: 32000, // High limit since we're targeting 4-8k per chunk
      temperature: 1,
      // Note: thinking cannot be enabled when tool_choice forces tool use
      system: [
        {
          type: 'text',
          text: systemPrompt,
          cache_control: { type: 'ephemeral' }
        }
      ],
      messages: [
        {
          role: 'user',
          content: phase.prompt
        }
      ],
      tools: [{
        name: 'generate_react_component',
        description: 'Generate a complete React component with all necessary code',
        input_schema: {
          type: 'object',
          properties: {
            code: {
              type: 'string',
              description: 'Complete React component code'
            },
            description: {
              type: 'string',
              description: 'Brief description of what was generated'
            }
          },
          required: ['code', 'description']
        }
      }],
      tool_choice: {
        type: 'tool',
        name: 'generate_react_component'
      }
    })

    let rawResponse = ''
    let toolUseInput: any = null
    let tokenUsage = { input: 0, output: 0, total: 0 }

    // Process stream
    for await (const event of stream) {
      if (event.type === 'content_block_delta') {
        if (event.delta.type === 'input_json_delta') {
          rawResponse += event.delta.partial_json
        }
      } else if (event.type === 'message_stop') {
        const message = await stream.finalMessage()
        tokenUsage.input = message.usage.input_tokens
        tokenUsage.output = message.usage.output_tokens
        tokenUsage.total = tokenUsage.input + tokenUsage.output

        // Extract tool use
        const toolUse = message.content.find(c => c.type === 'tool_use')
        if (toolUse && toolUse.type === 'tool_use') {
          toolUseInput = toolUse.input
        }
      }
    }

    if (!toolUseInput) {
      throw new Error('No tool use found in response')
    }

    onProgress(phaseNum, totalPhases, `Extracting and validating code for phase ${phaseNum}...`, {
      outputTokens: tokenUsage.output
    })

    // Extract code
    let code = extractComponentCode(toolUseInput)

    // Validate code (auto-fixes are applied internally by validateGeneratedCode)
    const validation = validateGeneratedCode(code)

    // Use the validated/fixed code
    code = validation.code
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

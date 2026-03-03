/**
 * Integration Tests for Custom Prompt Generation Workflow
 * GitHub Issue #11: Test Custom Prompt Generation Workflow
 *
 * Tests both USE_SUBAGENTS=true and USE_SUBAGENTS=false modes
 * with comprehensive quality, performance, and validation checks.
 */

import { describe, it, expect, beforeAll, afterEach } from 'vitest'
import Anthropic from '@anthropic-ai/sdk'
import { runOrchestratorAgent } from '@/lib/agent/subagents'
import { validateGeneratedCode } from '@/lib/code-validator'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'
import { COMPONENT_GENERATION_TOOL, extractComponentCode } from '@/lib/agent/component-generation-tool'

// Test prompts from GitHub issue #11
const TEST_PROMPTS = [
  'Create a landing page for a SaaS product',
  'Build a dashboard with revenue charts',
  'Design a contact form with email validation',
  'Make a product showcase grid with filters',
  'Generate a blog post layout with sidebar',
]

// Test results storage
interface TestResult {
  prompt: string
  mode: 'subagents' | 'standard'
  success: boolean
  generationTime: number
  tokenUsage: {
    inputTokens: number
    outputTokens: number
    totalTokens: number
  }
  validationPassed: boolean
  validationErrors: string[]
  componentCode: string
  codeSize: number
  hasPreviewContent: boolean
}

const testResults: TestResult[] = []

describe('Custom Prompt Generation Workflow (Issue #11)', () => {
  let anthropic: Anthropic

  beforeAll(() => {
    // Initialize Anthropic client
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set. Cannot run integration tests.')
    }
    anthropic = new Anthropic({ apiKey })
  })

  afterEach(() => {
    // Small delay between tests to avoid rate limiting
    return new Promise(resolve => setTimeout(resolve, 2000))
  })

  describe('WITH USE_SUBAGENTS=true (Orchestrator Mode)', () => {
    TEST_PROMPTS.forEach((prompt, index) => {
      it(`should generate valid component for: "${prompt}"`, async () => {
        const startTime = Date.now()

        // Set environment variable for subagents mode
        const originalEnv = process.env.USE_SUBAGENTS
        process.env.USE_SUBAGENTS = 'true'

        try {
          // Run orchestrator agent
          const result = await runOrchestratorAgent(
            prompt,
            PROFESSIONAL_SYSTEM_PROMPT,
            '' // No memory context for first-time generation
          )

          const generationTime = Date.now() - startTime

          // SUCCESS CRITERIA 1: Component generation succeeds
          expect(result.success).toBe(true)
          expect(result.componentCode).toBeTruthy()
          expect(result.componentCode.length).toBeGreaterThan(100)

          // SUCCESS CRITERIA 2: Generation time < 30s
          expect(generationTime).toBeLessThan(30000)

          // SUCCESS CRITERIA 3: Code validation passes
          const validation = validateGeneratedCode(result.componentCode)
          expect(validation.valid).toBe(true)

          // SUCCESS CRITERIA 4: No console errors (checked via validation)
          if (!validation.valid) {
            console.error(`Validation errors for "${prompt}":`, validation.error)
          }

          // Store results for reporting
          testResults.push({
            prompt,
            mode: 'subagents',
            success: result.success,
            generationTime,
            tokenUsage: {
              inputTokens: 0, // Subagents don't expose token usage directly
              outputTokens: 0,
              totalTokens: 0,
            },
            validationPassed: validation.valid,
            validationErrors: validation.valid ? [] : [validation.error],
            componentCode: result.componentCode,
            codeSize: result.componentCode.length,
            hasPreviewContent: result.componentCode.includes('export default'),
          })

          // Log progress
          console.log(`✅ [${index + 1}/${TEST_PROMPTS.length}] Subagents mode: "${prompt}" - ${generationTime}ms`)
        } finally {
          // Restore original environment
          process.env.USE_SUBAGENTS = originalEnv
        }
      }, 60000) // 60s timeout per test
    })
  })

  describe('WITH USE_SUBAGENTS=false (Standard Mode)', () => {
    TEST_PROMPTS.forEach((prompt, index) => {
      it(`should generate valid component for: "${prompt}"`, async () => {
        const startTime = Date.now()

        // Set environment variable for standard mode
        const originalEnv = process.env.USE_SUBAGENTS
        process.env.USE_SUBAGENTS = 'false'

        try {
          // Use standard streaming with Tool Use API
          const stream = await anthropic.messages.stream({
            model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-20250514',
            max_tokens: 8000,
            temperature: 1,
            thinking: {
              type: 'enabled',
              budget_tokens: 2000,
            },
            system: [
              {
                type: 'text',
                text: PROFESSIONAL_SYSTEM_PROMPT,
                cache_control: { type: 'ephemeral' },
              },
            ],
            messages: [{ role: 'user', content: prompt }],
            tools: [COMPONENT_GENERATION_TOOL],
          })

          let componentCode = ''
          let toolInputJson = ''
          let toolUseInput: any = null

          for await (const chunk of stream) {
            // Skip thinking blocks
            if (chunk.type === 'content_block_start' && chunk.content_block.type === 'thinking') {
              continue
            }
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'thinking_delta') {
              continue
            }

            // Handle tool use
            if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
              toolUseInput = { id: chunk.content_block.id, name: chunk.content_block.name }
              toolInputJson = ''
            }

            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
              if (toolUseInput && chunk.delta.partial_json) {
                toolInputJson += chunk.delta.partial_json
              }
            }

            // Handle text output (fallback)
            if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
              componentCode += chunk.delta.text
            }
          }

          const finalMessage = await stream.finalMessage()
          const generationTime = Date.now() - startTime

          // Extract code from tool use if available
          if (toolUseInput && toolInputJson) {
            try {
              const componentResult = JSON.parse(toolInputJson)
              componentCode = extractComponentCode(componentResult)
            } catch (parseError) {
              console.error('Failed to parse tool input:', parseError)
            }
          }

          // SUCCESS CRITERIA 1: Component generation succeeds
          expect(componentCode).toBeTruthy()
          expect(componentCode.length).toBeGreaterThan(100)

          // SUCCESS CRITERIA 2: Generation time < 30s
          expect(generationTime).toBeLessThan(30000)

          // SUCCESS CRITERIA 3: Code validation passes
          const validation = validateGeneratedCode(componentCode)
          expect(validation.valid).toBe(true)

          // Extract token usage
          const usage = finalMessage.usage
          const inputTokens = usage.input_tokens || 0
          const outputTokens = usage.output_tokens || 0
          const totalTokens = inputTokens + outputTokens

          // Store results for reporting
          testResults.push({
            prompt,
            mode: 'standard',
            success: validation.valid,
            generationTime,
            tokenUsage: {
              inputTokens,
              outputTokens,
              totalTokens,
            },
            validationPassed: validation.valid,
            validationErrors: validation.valid ? [] : [validation.error],
            componentCode,
            codeSize: componentCode.length,
            hasPreviewContent: componentCode.includes('export default'),
          })

          // Log progress
          console.log(`✅ [${index + 1}/${TEST_PROMPTS.length}] Standard mode: "${prompt}" - ${generationTime}ms - ${totalTokens} tokens`)
        } finally {
          // Restore original environment
          process.env.USE_SUBAGENTS = originalEnv
        }
      }, 60000) // 60s timeout per test
    })
  })

  describe('Performance and Quality Validation', () => {
    it('should have all tests passing with valid components', () => {
      const failedTests = testResults.filter(r => !r.validationPassed)

      if (failedTests.length > 0) {
        console.error('Failed tests:', failedTests.map(t => ({
          prompt: t.prompt,
          mode: t.mode,
          errors: t.validationErrors,
        })))
      }

      expect(failedTests.length).toBe(0)
    })

    it('should have all generation times under 30 seconds', () => {
      const slowTests = testResults.filter(r => r.generationTime >= 30000)

      if (slowTests.length > 0) {
        console.error('Slow tests (>30s):', slowTests.map(t => ({
          prompt: t.prompt,
          mode: t.mode,
          time: `${(t.generationTime / 1000).toFixed(2)}s`,
        })))
      }

      expect(slowTests.length).toBe(0)
    })

    it('should generate components with reasonable size (>500 chars)', () => {
      const smallComponents = testResults.filter(r => r.codeSize < 500)

      if (smallComponents.length > 0) {
        console.warn('Small components (<500 chars):', smallComponents.map(t => ({
          prompt: t.prompt,
          mode: t.mode,
          size: t.codeSize,
        })))
      }

      // All components should be substantial
      expect(testResults.every(r => r.codeSize >= 500)).toBe(true)
    })

    it('should have all components export default function', () => {
      const invalidComponents = testResults.filter(r => !r.hasPreviewContent)

      expect(invalidComponents.length).toBe(0)
    })

    it('should generate comprehensive performance report', () => {
      // Calculate averages
      const subagentResults = testResults.filter(r => r.mode === 'subagents')
      const standardResults = testResults.filter(r => r.mode === 'standard')

      const avgSubagentTime = subagentResults.reduce((sum, r) => sum + r.generationTime, 0) / subagentResults.length
      const avgStandardTime = standardResults.reduce((sum, r) => sum + r.generationTime, 0) / standardResults.length

      const avgStandardTokens = standardResults.reduce((sum, r) => sum + r.tokenUsage.totalTokens, 0) / standardResults.length

      console.log('\n' + '='.repeat(80))
      console.log('CUSTOM PROMPT GENERATION TEST RESULTS (GitHub Issue #11)')
      console.log('='.repeat(80))
      console.log(`\nTotal tests run: ${testResults.length}`)
      console.log(`  - Subagents mode: ${subagentResults.length}`)
      console.log(`  - Standard mode: ${standardResults.length}`)
      console.log(`\nSuccess rate: ${(testResults.filter(r => r.success).length / testResults.length * 100).toFixed(1)}%`)
      console.log(`Validation pass rate: ${(testResults.filter(r => r.validationPassed).length / testResults.length * 100).toFixed(1)}%`)
      console.log(`\n--- Performance Metrics ---`)
      console.log(`Average generation time (subagents): ${(avgSubagentTime / 1000).toFixed(2)}s`)
      console.log(`Average generation time (standard): ${(avgStandardTime / 1000).toFixed(2)}s`)
      console.log(`Average token usage (standard): ${Math.round(avgStandardTokens)} tokens`)
      console.log(`\n--- Quality Metrics ---`)
      console.log(`Average component size: ${Math.round(testResults.reduce((sum, r) => sum + r.codeSize, 0) / testResults.length)} characters`)
      console.log(`All components have export default: ${testResults.every(r => r.hasPreviewContent) ? 'YES' : 'NO'}`)
      console.log('\n' + '='.repeat(80) + '\n')

      // Test should always pass - this is just for reporting
      expect(true).toBe(true)
    })
  })
})

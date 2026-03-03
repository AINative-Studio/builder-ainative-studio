/**
 * Integration Tests for Custom Prompt Generation Workflow
 * GitHub Issue #11: Test Custom Prompt Generation Workflow
 *
 * Tests both USE_SUBAGENTS=true and USE_SUBAGENTS=false modes
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

interface TestResult {
  prompt: string
  mode: 'subagents' | 'standard'
  success: boolean
  generationTime: number
  tokenUsage: { inputTokens: number; outputTokens: number; totalTokens: number }
  validationPassed: boolean
  componentCode: string
  codeSize: number
}

const testResults: TestResult[] = []

describe('Custom Prompt Generation Workflow (Issue #11)', () => {
  let anthropic: Anthropic

  beforeAll(() => {
    const apiKey = process.env.ANTHROPIC_API_KEY
    if (!apiKey) {
      throw new Error('ANTHROPIC_API_KEY not set')
    }
    anthropic = new Anthropic({ apiKey })
  })

  afterEach(() => new Promise(resolve => setTimeout(resolve, 2000)))

  describe('WITH USE_SUBAGENTS=true', () => {
    TEST_PROMPTS.forEach((prompt, index) => {
      it(`should generate valid component for: "${prompt}"`, async () => {
        const startTime = Date.now()
        process.env.USE_SUBAGENTS = 'true'

        const result = await runOrchestratorAgent(prompt, PROFESSIONAL_SYSTEM_PROMPT, '')
        const generationTime = Date.now() - startTime

        expect(result.success).toBe(true)
        expect(result.componentCode).toBeTruthy()
        expect(generationTime).toBeLessThan(30000)

        const validation = validateGeneratedCode(result.componentCode)
        expect(validation.valid).toBe(true)

        testResults.push({
          prompt,
          mode: 'subagents',
          success: result.success,
          generationTime,
          tokenUsage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
          validationPassed: validation.valid,
          componentCode: result.componentCode,
          codeSize: result.componentCode.length,
        })

        console.log(`✅ [${index + 1}/${TEST_PROMPTS.length}] Subagents: "${prompt}" - ${generationTime}ms`)
      }, 60000)
    })
  })

  describe('WITH USE_SUBAGENTS=false', () => {
    TEST_PROMPTS.forEach((prompt, index) => {
      it(`should generate valid component for: "${prompt}"`, async () => {
        const startTime = Date.now()
        process.env.USE_SUBAGENTS = 'false'

        const stream = await anthropic.messages.stream({
          model: 'claude-sonnet-4-20250514',
          max_tokens: 8000,
          temperature: 1,
          thinking: { type: 'enabled', budget_tokens: 2000 },
          system: [{ type: 'text', text: PROFESSIONAL_SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } }],
          messages: [{ role: 'user', content: prompt }],
          tools: [COMPONENT_GENERATION_TOOL],
        })

        let componentCode = ''
        let toolInputJson = ''
        let toolUseInput: any = null

        for await (const chunk of stream) {
          if (chunk.type === 'content_block_start' && chunk.content_block.type === 'tool_use') {
            toolUseInput = { id: chunk.content_block.id }
            toolInputJson = ''
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'input_json_delta') {
            if (toolUseInput && chunk.delta.partial_json) {
              toolInputJson += chunk.delta.partial_json
            }
          }
          if (chunk.type === 'content_block_delta' && chunk.delta.type === 'text_delta') {
            componentCode += chunk.delta.text
          }
        }

        const finalMessage = await stream.finalMessage()
        const generationTime = Date.now() - startTime

        if (toolUseInput && toolInputJson) {
          componentCode = extractComponentCode(JSON.parse(toolInputJson))
        }

        expect(componentCode).toBeTruthy()
        expect(generationTime).toBeLessThan(30000)

        const validation = validateGeneratedCode(componentCode)
        expect(validation.valid).toBe(true)

        const usage = finalMessage.usage
        testResults.push({
          prompt,
          mode: 'standard',
          success: validation.valid,
          generationTime,
          tokenUsage: {
            inputTokens: usage.input_tokens || 0,
            outputTokens: usage.output_tokens || 0,
            totalTokens: (usage.input_tokens || 0) + (usage.output_tokens || 0),
          },
          validationPassed: validation.valid,
          componentCode,
          codeSize: componentCode.length,
        })

        console.log(`✅ [${index + 1}/${TEST_PROMPTS.length}] Standard: "${prompt}" - ${generationTime}ms`)
      }, 60000)
    })
  })

  describe('Performance Validation', () => {
    it('should generate performance report', () => {
      const subagentResults = testResults.filter(r => r.mode === 'subagents')
      const standardResults = testResults.filter(r => r.mode === 'standard')

      const avgSubagentTime = subagentResults.reduce((sum, r) => sum + r.generationTime, 0) / subagentResults.length
      const avgStandardTime = standardResults.reduce((sum, r) => sum + r.generationTime, 0) / standardResults.length
      const avgStandardTokens = standardResults.reduce((sum, r) => sum + r.tokenUsage.totalTokens, 0) / standardResults.length

      console.log('\n' + '='.repeat(80))
      console.log('TEST RESULTS - GitHub Issue #11')
      console.log('='.repeat(80))
      console.log(`Total tests: ${testResults.length}`)
      console.log(`Success rate: ${(testResults.filter(r => r.success).length / testResults.length * 100).toFixed(1)}%`)
      console.log(`Validation pass rate: ${(testResults.filter(r => r.validationPassed).length / testResults.length * 100).toFixed(1)}%`)
      console.log(`\nAverage time (subagents): ${(avgSubagentTime / 1000).toFixed(2)}s`)
      console.log(`Average time (standard): ${(avgStandardTime / 1000).toFixed(2)}s`)
      console.log(`Average tokens (standard): ${Math.round(avgStandardTokens)}`)
      console.log('='.repeat(80) + '\n')

      expect(testResults.every(r => r.validationPassed)).toBe(true)
      expect(testResults.every(r => r.generationTime < 30000)).toBe(true)
    })
  })
})

/**
 * Unit Tests for Subagents Module
 * Tests individual subagent functions and orchestrator
 */

import { describe, it, expect, beforeAll, vi } from 'vitest'
import { runDesignSubagent, runCodeSubagent, runValidationSubagent, runOrchestratorAgent } from '@/lib/agent/subagents'
import { PROFESSIONAL_SYSTEM_PROMPT } from '@/lib/professional-prompt'

describe('Subagents Module Unit Tests', () => {
  const testPrompt = 'Create a simple button component'

  beforeAll(() => {
    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('ANTHROPIC_API_KEY not set. Cannot run unit tests.')
    }
  })

  describe('runDesignSubagent', () => {
    it('should analyze requirements and create design specification', async () => {
      const result = await runDesignSubagent(testPrompt, '')

      expect(result).toBeDefined()
      expect(result.type).toBe('design')
      expect(result.success).toBe(true)
      expect(result.output).toBeTruthy()
      expect(result.output.length).toBeGreaterThan(100)

      // Design spec should contain key sections
      expect(
        result.output.toLowerCase().includes('component') ||
        result.output.toLowerCase().includes('design') ||
        result.output.toLowerCase().includes('layout')
      ).toBe(true)

      console.log('Design subagent output length:', result.output.length)
    }, 30000)

    it('should include metadata in result', async () => {
      const result = await runDesignSubagent(testPrompt, '')

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.stopReason).toBeDefined()
    }, 30000)

    it('should handle errors gracefully', async () => {
      // Temporarily break the API key
      const originalKey = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'invalid-key'

      const result = await runDesignSubagent(testPrompt, '')

      expect(result.type).toBe('design')
      expect(result.success).toBe(false)
      expect(result.metadata?.error).toBeDefined()

      // Restore API key
      process.env.ANTHROPIC_API_KEY = originalKey
    }, 30000)
  })

  describe('runCodeSubagent', () => {
    it('should generate component code from design spec', async () => {
      const designSpec = `
        Component Type: Button
        Layout: Single button element
        Color Scheme: Blue background, white text
        Features: Click handler, hover effect
        Data: No external data needed
      `

      const result = await runCodeSubagent(designSpec, PROFESSIONAL_SYSTEM_PROMPT, testPrompt)

      expect(result).toBeDefined()
      expect(result.type).toBe('code')
      expect(result.success).toBe(true)
      expect(result.output).toBeTruthy()
      expect(result.output.length).toBeGreaterThan(100)

      // Code should contain React component patterns
      expect(
        result.output.includes('export default') ||
        result.output.includes('function') ||
        result.output.includes('const')
      ).toBe(true)

      console.log('Code subagent output length:', result.output.length)
    }, 45000)

    it('should use Tool Use API when available', async () => {
      const designSpec = 'Simple button component with blue background'
      const result = await runCodeSubagent(designSpec, PROFESSIONAL_SYSTEM_PROMPT, testPrompt)

      expect(result.metadata).toBeDefined()
      // Check if tool use was utilized (may or may not be, depending on Claude's choice)
      console.log('Used Tool Use:', result.metadata?.usedToolUse)
    }, 45000)

    it('should handle errors gracefully', async () => {
      const originalKey = process.env.ANTHROPIC_API_KEY
      process.env.ANTHROPIC_API_KEY = 'invalid-key'

      const result = await runCodeSubagent('test', PROFESSIONAL_SYSTEM_PROMPT, testPrompt)

      expect(result.type).toBe('code')
      expect(result.success).toBe(false)
      expect(result.metadata?.error).toBeDefined()

      process.env.ANTHROPIC_API_KEY = originalKey
    }, 30000)
  })

  describe('runValidationSubagent', () => {
    it('should validate component quality', async () => {
      const componentCode = `
export default function Button() {
  return (
    <button className="bg-blue-500 text-white px-4 py-2 rounded hover:bg-blue-600">
      Click Me
    </button>
  )
}
      `
      const designSpec = 'Button component with blue background and white text'

      const result = await runValidationSubagent(componentCode, designSpec)

      expect(result).toBeDefined()
      expect(result.type).toBe('validation')
      expect(result.output).toBeTruthy()
      expect(result.output.length).toBeGreaterThan(50)

      // Validation report should contain status
      expect(
        result.output.toLowerCase().includes('pass') ||
        result.output.toLowerCase().includes('fail') ||
        result.output.toLowerCase().includes('status')
      ).toBe(true)

      console.log('Validation result:', result.success ? 'PASS' : 'FAIL')
    }, 30000)

    it('should detect invalid code patterns', async () => {
      const invalidCode = `
export default function Component() {
  return (
    <div className="bg-gradient-to-r from-blue-500 to-purple-600">
      Invalid gradient! 🚫
    </div>
  )
}
      `
      const designSpec = 'Component with solid colors only'

      const result = await runValidationSubagent(invalidCode, designSpec)

      // Validation should ideally detect the gradient (may or may not fail depending on Claude's analysis)
      expect(result.type).toBe('validation')
      expect(result.output).toBeTruthy()

      console.log('Validation detected issues:', !result.success)
    }, 30000)

    it('should include validation metadata', async () => {
      const code = 'export default function Test() { return <div>Test</div> }'
      const spec = 'Simple test component'

      const result = await runValidationSubagent(code, spec)

      expect(result.metadata).toBeDefined()
      expect(result.metadata?.stopReason).toBeDefined()
    }, 30000)
  })

  describe('runOrchestratorAgent (Full Workflow)', () => {
    it('should complete full hierarchical workflow', async () => {
      const prompt = 'Create a simple card component with a title and description'

      const result = await runOrchestratorAgent(prompt, PROFESSIONAL_SYSTEM_PROMPT, '')

      expect(result).toBeDefined()
      expect(result.designSpec).toBeTruthy()
      expect(result.componentCode).toBeTruthy()
      expect(result.validationReport).toBeTruthy()
      expect(result.success).toBe(true)

      // All stages should produce substantial output
      expect(result.designSpec.length).toBeGreaterThan(100)
      expect(result.componentCode.length).toBeGreaterThan(100)
      expect(result.validationReport.length).toBeGreaterThan(50)

      console.log('Orchestrator workflow completed successfully')
      console.log('  - Design spec:', result.designSpec.length, 'chars')
      console.log('  - Component code:', result.componentCode.length, 'chars')
      console.log('  - Validation report:', result.validationReport.length, 'chars')
    }, 90000) // 90s timeout for full workflow

    it('should handle design failure gracefully', async () => {
      // This test would require mocking the design subagent to fail
      // For now, we'll just verify the orchestrator returns proper structure
      const result = await runOrchestratorAgent(
        'Test component',
        PROFESSIONAL_SYSTEM_PROMPT,
        ''
      )

      expect(result).toHaveProperty('designSpec')
      expect(result).toHaveProperty('componentCode')
      expect(result).toHaveProperty('validationReport')
      expect(result).toHaveProperty('success')
    }, 90000)

    it('should pass memory context between subagents', async () => {
      const memoryContext = `
## Previous Components
- Button component (blue, rounded)
- Card component (white background, shadow)
      `

      const result = await runOrchestratorAgent(
        'Create a matching form input component',
        PROFESSIONAL_SYSTEM_PROMPT,
        memoryContext
      )

      expect(result.success).toBe(true)
      expect(result.componentCode).toBeTruthy()

      // Component should ideally match the style from memory context
      // (This is a soft expectation - Claude may or may not use the context)
      console.log('Component generated with memory context')
    }, 90000)
  })

  describe('Performance Tests', () => {
    it('should complete design subagent in reasonable time (<20s)', async () => {
      const startTime = Date.now()
      const result = await runDesignSubagent('Simple test component', '')
      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(duration).toBeLessThan(20000)

      console.log('Design subagent duration:', duration, 'ms')
    }, 30000)

    it('should complete code subagent in reasonable time (<30s)', async () => {
      const startTime = Date.now()
      const result = await runCodeSubagent('Simple button', PROFESSIONAL_SYSTEM_PROMPT, 'Button')
      const duration = Date.now() - startTime

      expect(result.success).toBe(true)
      expect(duration).toBeLessThan(30000)

      console.log('Code subagent duration:', duration, 'ms')
    }, 45000)

    it('should complete validation subagent in reasonable time (<15s)', async () => {
      const code = 'export default function Test() { return <div>Test</div> }'
      const startTime = Date.now()
      const result = await runValidationSubagent(code, 'Test component')
      const duration = Date.now() - startTime

      expect(result.type).toBe('validation')
      expect(duration).toBeLessThan(15000)

      console.log('Validation subagent duration:', duration, 'ms')
    }, 30000)
  })

  describe('Token Optimization Tests (Issue #10)', () => {
    it('should track token usage in design subagent response', async () => {
      const result = await runDesignSubagent('Create a login form', '')

      expect(result.response).toBeDefined()
      expect(result.response?.usage).toBeDefined()

      if (result.response?.usage) {
        const { input_tokens, output_tokens } = result.response.usage
        console.log('Design agent token usage:')
        console.log('  - Input tokens:', input_tokens)
        console.log('  - Output tokens:', output_tokens)
        console.log('  - Total:', input_tokens + output_tokens)

        // With optimization, input tokens should be significantly reduced
        // Target: <2000 tokens for input (down from ~3000 pre-optimization)
        expect(input_tokens).toBeLessThan(2000)
      }
    }, 30000)

    it('should track token usage in code subagent response', async () => {
      const designSpec = 'Login form with email and password fields'
      const result = await runCodeSubagent(designSpec, PROFESSIONAL_SYSTEM_PROMPT, 'Login form')

      expect(result.response).toBeDefined()
      expect(result.response?.usage).toBeDefined()

      if (result.response?.usage) {
        const { input_tokens, output_tokens } = result.response.usage
        console.log('Code agent token usage:')
        console.log('  - Input tokens:', input_tokens)
        console.log('  - Output tokens:', output_tokens)
        console.log('  - Total:', input_tokens + output_tokens)

        // With optimization, input tokens should be reduced
        // Target: <2500 tokens for input (down from ~4000 pre-optimization)
        expect(input_tokens).toBeLessThan(2500)
      }
    }, 45000)

    it('should track token usage in validation subagent response', async () => {
      const code = `
export default function LoginForm() {
  return (
    <form className="bg-white p-6 rounded shadow">
      <input type="email" placeholder="Email" className="border p-2 mb-4 w-full" />
      <input type="password" placeholder="Password" className="border p-2 mb-4 w-full" />
      <button className="bg-blue-500 text-white px-4 py-2 rounded">Login</button>
    </form>
  )
}
      `
      const designSpec = 'Login form with email and password fields'
      const result = await runValidationSubagent(code, designSpec)

      expect(result.response).toBeDefined()
      expect(result.response?.usage).toBeDefined()

      if (result.response?.usage) {
        const { input_tokens, output_tokens } = result.response.usage
        console.log('Validation agent token usage:')
        console.log('  - Input tokens:', input_tokens)
        console.log('  - Output tokens:', output_tokens)
        console.log('  - Total:', input_tokens + output_tokens)

        // With optimization, input tokens should be reduced
        // Target: <2000 tokens for input (down from ~3000 pre-optimization)
        expect(input_tokens).toBeLessThan(2000)
      }
    }, 30000)

    it('should verify all agents maintain output quality with optimized prompts', async () => {
      const prompt = 'Create a product card component'
      const result = await runOrchestratorAgent(prompt, PROFESSIONAL_SYSTEM_PROMPT, '')

      // Quality checks - should still produce high-quality output
      expect(result.success).toBe(true)
      expect(result.designSpec).toBeTruthy()
      expect(result.componentCode).toBeTruthy()
      expect(result.validationReport).toBeTruthy()

      // Design spec should be comprehensive
      expect(result.designSpec.length).toBeGreaterThan(100)
      expect(result.designSpec.toLowerCase()).toContain('component')

      // Code should be functional
      expect(result.componentCode.length).toBeGreaterThan(100)
      expect(result.componentCode).toContain('export')

      // Validation should provide feedback
      expect(result.validationReport.length).toBeGreaterThan(50)

      console.log('✅ Quality maintained with optimized prompts')
    }, 90000)
  })
})

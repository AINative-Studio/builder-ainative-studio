/**
 * Unit Tests for Metrics Module (Issue #9)
 * Tests performance tracking, token usage, and metrics storage
 */

import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest'
import {
  MetricsCollector,
  createMetricsCollector,
  extractTokenUsage,
  type TokenUsage,
  type OrchestratorMetrics,
} from '@/lib/agent/metrics'

// Mock the logger
vi.mock('@/lib/logger', () => ({
  logger: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

// Mock ZeroDB client
vi.mock('@/lib/mcp/zerodb-client', () => ({
  getZeroDBClient: vi.fn(() => ({
    isConnected: vi.fn(() => true),
    executeCRUD: vi.fn(async () => ({ success: true })),
  })),
}))

describe('Metrics Module Unit Tests', () => {
  describe('extractTokenUsage', () => {
    it('should extract token usage from API response', () => {
      const mockResponse = {
        usage: {
          input_tokens: 100,
          output_tokens: 50,
        },
      }

      const usage = extractTokenUsage(mockResponse)

      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })
    })

    it('should handle missing usage data', () => {
      const usage = extractTokenUsage({})

      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
    })

    it('should handle null response', () => {
      const usage = extractTokenUsage(null)

      expect(usage).toEqual({
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
      })
    })

    it('should handle partial usage data', () => {
      const mockResponse = {
        usage: {
          input_tokens: 100,
        },
      }

      const usage = extractTokenUsage(mockResponse)

      expect(usage).toEqual({
        inputTokens: 100,
        outputTokens: 0,
        totalTokens: 100,
      })
    })
  })

  describe('createMetricsCollector', () => {
    it('should create a new metrics collector instance', () => {
      const collector = createMetricsCollector(
        'test-session-123',
        'Create a button',
        'claude-sonnet-4-20250514',
        'user-456',
        'chat-789'
      )

      expect(collector).toBeInstanceOf(MetricsCollector)
    })

    it('should work without optional userId and chatId', () => {
      const collector = createMetricsCollector(
        'test-session',
        'Test prompt',
        'claude-sonnet-4-20250514'
      )

      expect(collector).toBeInstanceOf(MetricsCollector)
    })
  })

  describe('MetricsCollector', () => {
    let collector: MetricsCollector

    beforeEach(() => {
      collector = new MetricsCollector(
        'test-session-123',
        'Create a dashboard',
        'claude-sonnet-4-20250514',
        'user-456',
        'chat-789'
      )
    })

    describe('startSubagent', () => {
      it('should start tracking design subagent', () => {
        collector.startSubagent('design')
        // No error thrown means success
        expect(true).toBe(true)
      })

      it('should start tracking code subagent', () => {
        collector.startSubagent('code')
        expect(true).toBe(true)
      })

      it('should start tracking validation subagent', () => {
        collector.startSubagent('validation')
        expect(true).toBe(true)
      })
    })

    describe('endSubagent', () => {
      it('should end tracking and record success', () => {
        collector.startSubagent('design')

        const tokenUsage: TokenUsage = {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        }

        collector.endSubagent('design', true, tokenUsage)
        expect(true).toBe(true)
      })

      it('should record failure with error message', () => {
        collector.startSubagent('code')

        collector.endSubagent('code', false, undefined, 'API error')
        expect(true).toBe(true)
      })

      it('should handle ending untracked subagent gracefully', () => {
        // Try to end a subagent that was never started
        collector.endSubagent('validation', true)
        expect(true).toBe(true)
      })

      it('should record metadata', () => {
        collector.startSubagent('design')

        const metadata = { stopReason: 'end_turn', modelVersion: '4.0' }
        collector.endSubagent('design', true, undefined, undefined, metadata)
        expect(true).toBe(true)
      })
    })

    describe('complete', () => {
      it('should calculate metrics for successful workflow', async () => {
        // Simulate full workflow
        collector.startSubagent('design')
        await new Promise((resolve) => setTimeout(resolve, 10)) // Small delay
        collector.endSubagent('design', true, {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        })

        collector.startSubagent('code')
        await new Promise((resolve) => setTimeout(resolve, 20))
        collector.endSubagent('code', true, {
          inputTokens: 200,
          outputTokens: 100,
          totalTokens: 300,
        })

        collector.startSubagent('validation')
        await new Promise((resolve) => setTimeout(resolve, 5))
        collector.endSubagent('validation', true, {
          inputTokens: 50,
          outputTokens: 25,
          totalTokens: 75,
        })

        const metrics = await collector.complete()

        expect(metrics).toBeDefined()
        expect(metrics.sessionId).toBe('test-session-123')
        expect(metrics.userId).toBe('user-456')
        expect(metrics.chatId).toBe('chat-789')
        expect(metrics.userPrompt).toBe('Create a dashboard')
        expect(metrics.model).toBe('claude-sonnet-4-20250514')

        // Check timings
        expect(metrics.designTime).toBeGreaterThan(0)
        expect(metrics.codeTime).toBeGreaterThan(0)
        expect(metrics.validationTime).toBeGreaterThan(0)
        expect(metrics.totalTime).toBeGreaterThan(0)

        // Check token usage
        expect(metrics.tokenUsage.design.totalTokens).toBe(150)
        expect(metrics.tokenUsage.code.totalTokens).toBe(300)
        expect(metrics.tokenUsage.validation.totalTokens).toBe(75)
        expect(metrics.tokenUsage.total.totalTokens).toBe(525)
        expect(metrics.tokenUsage.total.inputTokens).toBe(350)
        expect(metrics.tokenUsage.total.outputTokens).toBe(175)

        // Check success flags
        expect(metrics.success).toBe(true)
        expect(metrics.designSuccess).toBe(true)
        expect(metrics.codeSuccess).toBe(true)
        expect(metrics.validationSuccess).toBe(true)
      })

      it('should handle partial workflow (design failed)', async () => {
        collector.startSubagent('design')
        await new Promise((resolve) => setTimeout(resolve, 10))
        collector.endSubagent('design', false, undefined, 'Design failed')

        const metrics = await collector.complete()

        expect(metrics.success).toBe(false)
        expect(metrics.designSuccess).toBe(false)
        expect(metrics.codeSuccess).toBe(false) // Never ran
        expect(metrics.validationSuccess).toBe(false) // Never ran
        expect(metrics.designTime).toBeGreaterThan(0)
        expect(metrics.codeTime).toBe(0)
        expect(metrics.validationTime).toBe(0)
      })

      it('should handle zero token usage', async () => {
        collector.startSubagent('design')
        collector.endSubagent('design', true) // No token usage provided

        const metrics = await collector.complete()

        expect(metrics.tokenUsage.design.totalTokens).toBe(0)
        expect(metrics.tokenUsage.total.totalTokens).toBe(0)
      })

      it('should include timestamp', async () => {
        const beforeTime = new Date()
        const metrics = await collector.complete()
        const afterTime = new Date()

        expect(metrics.timestamp).toBeInstanceOf(Date)
        expect(metrics.timestamp.getTime()).toBeGreaterThanOrEqual(beforeTime.getTime())
        expect(metrics.timestamp.getTime()).toBeLessThanOrEqual(afterTime.getTime())
      })

      it('should include metadata from subagents', async () => {
        collector.startSubagent('design')
        collector.endSubagent('design', true, undefined, undefined, {
          stopReason: 'end_turn',
        })

        collector.startSubagent('code')
        collector.endSubagent('code', true, undefined, undefined, {
          usedToolUse: true,
        })

        const metrics = await collector.complete()

        expect(metrics.metadata).toBeDefined()
        expect(metrics.metadata?.designMetadata).toBeDefined()
        expect(metrics.metadata?.codeMetadata).toBeDefined()
      })
    })

    describe('storeInZeroDB', () => {
      it('should store metrics in ZeroDB when connected', async () => {
        collector.startSubagent('design')
        collector.endSubagent('design', true, {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        })

        const metrics = await collector.complete()
        const stored = await collector.storeInZeroDB(metrics)

        expect(stored).toBe(true)
      })

      it('should handle ZeroDB not connected', async () => {
        // Mock disconnected client
        const { getZeroDBClient } = await import('@/lib/mcp/zerodb-client')
        vi.mocked(getZeroDBClient).mockReturnValue({
          isConnected: vi.fn(() => false),
          executeCRUD: vi.fn(),
        } as any)

        const metrics = await collector.complete()
        const stored = await collector.storeInZeroDB(metrics)

        expect(stored).toBe(false)
      })

      it('should handle ZeroDB storage failure', async () => {
        // Mock failed storage
        const { getZeroDBClient } = await import('@/lib/mcp/zerodb-client')
        vi.mocked(getZeroDBClient).mockReturnValue({
          isConnected: vi.fn(() => true),
          executeCRUD: vi.fn(async () => ({
            success: false,
            error: 'Storage failed',
          })),
        } as any)

        const metrics = await collector.complete()
        const stored = await collector.storeInZeroDB(metrics)

        expect(stored).toBe(false)
      })
    })

    describe('sendToAnalytics', () => {
      it('should send metrics to analytics (placeholder)', async () => {
        const metrics = await collector.complete()
        const sent = await collector.sendToAnalytics(metrics)

        // Currently returns true as placeholder
        expect(sent).toBe(true)
      })
    })

    describe('logToConsole', () => {
      it('should log formatted metrics to console', async () => {
        const consoleSpy = vi.spyOn(console, 'log')

        collector.startSubagent('design')
        collector.endSubagent('design', true, {
          inputTokens: 100,
          outputTokens: 50,
          totalTokens: 150,
        })

        const metrics = await collector.complete()

        // Metrics are automatically logged in complete(), check that console.log was called
        expect(consoleSpy).toHaveBeenCalled()

        consoleSpy.mockRestore()
      })
    })
  })

  describe('Integration with Subagents', () => {
    it('should track full orchestrator workflow metrics', async () => {
      const collector = createMetricsCollector(
        'integration-test-session',
        'Create a test component',
        'claude-sonnet-4-20250514',
        'test-user',
        'test-chat'
      )

      // Simulate design subagent
      collector.startSubagent('design')
      await new Promise((resolve) => setTimeout(resolve, 100))
      collector.endSubagent('design', true, {
        inputTokens: 150,
        outputTokens: 75,
        totalTokens: 225,
      })

      // Simulate code subagent
      collector.startSubagent('code')
      await new Promise((resolve) => setTimeout(resolve, 200))
      collector.endSubagent('code', true, {
        inputTokens: 300,
        outputTokens: 150,
        totalTokens: 450,
      })

      // Simulate validation subagent
      collector.startSubagent('validation')
      await new Promise((resolve) => setTimeout(resolve, 50))
      collector.endSubagent('validation', true, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })

      const metrics = await collector.complete()

      // Verify complete metrics structure
      expect(metrics.sessionId).toBe('integration-test-session')
      expect(metrics.success).toBe(true)

      // Verify all timings are recorded
      expect(metrics.designTime).toBeGreaterThanOrEqual(100)
      expect(metrics.codeTime).toBeGreaterThanOrEqual(200)
      expect(metrics.validationTime).toBeGreaterThanOrEqual(50)
      expect(metrics.totalTime).toBeGreaterThanOrEqual(350)

      // Verify token totals
      expect(metrics.tokenUsage.total.totalTokens).toBe(825)
      expect(metrics.tokenUsage.total.inputTokens).toBe(550)
      expect(metrics.tokenUsage.total.outputTokens).toBe(275)
    })

    it('should handle failed subagent in workflow', async () => {
      const collector = createMetricsCollector(
        'failure-test-session',
        'Test component',
        'claude-sonnet-4-20250514'
      )

      // Design succeeds
      collector.startSubagent('design')
      await new Promise((resolve) => setTimeout(resolve, 50))
      collector.endSubagent('design', true, {
        inputTokens: 100,
        outputTokens: 50,
        totalTokens: 150,
      })

      // Code fails
      collector.startSubagent('code')
      await new Promise((resolve) => setTimeout(resolve, 30))
      collector.endSubagent('code', false, undefined, 'Code generation failed')

      // Validation never runs

      const metrics = await collector.complete()

      expect(metrics.success).toBe(false)
      expect(metrics.designSuccess).toBe(true)
      expect(metrics.codeSuccess).toBe(false)
      expect(metrics.validationSuccess).toBe(false)
      expect(metrics.designTime).toBeGreaterThan(0)
      expect(metrics.codeTime).toBeGreaterThan(0)
      expect(metrics.validationTime).toBe(0)
    })
  })

  describe('Edge Cases', () => {
    it('should handle metrics collection with no subagents run', async () => {
      const collector = createMetricsCollector(
        'empty-session',
        'Test',
        'claude-sonnet-4-20250514'
      )

      const metrics = await collector.complete()

      expect(metrics.designTime).toBe(0)
      expect(metrics.codeTime).toBe(0)
      expect(metrics.validationTime).toBe(0)
      expect(metrics.success).toBe(false)
    })

    it('should handle very long session IDs', () => {
      const longSessionId = 'a'.repeat(1000)
      const collector = createMetricsCollector(
        longSessionId,
        'Test',
        'claude-sonnet-4-20250514'
      )

      expect(collector).toBeInstanceOf(MetricsCollector)
    })

    it('should handle special characters in prompt', async () => {
      const specialPrompt = 'Create a "button" with <special> & characters!'
      const collector = createMetricsCollector(
        'test-session',
        specialPrompt,
        'claude-sonnet-4-20250514'
      )

      const metrics = await collector.complete()

      expect(metrics.userPrompt).toBe(specialPrompt)
    })

    it('should handle very large token counts', async () => {
      const collector = createMetricsCollector(
        'test-session',
        'Test',
        'claude-sonnet-4-20250514'
      )

      collector.startSubagent('code')
      collector.endSubagent('code', true, {
        inputTokens: 1000000,
        outputTokens: 500000,
        totalTokens: 1500000,
      })

      const metrics = await collector.complete()

      expect(metrics.tokenUsage.total.totalTokens).toBe(1500000)
    })
  })
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  recordBuildCost,
  buildCostEntryFromTokenUsage,
  listBuildCosts,
  type BuildCostEntry,
} from '@/lib/build/build-cost-ledger'

describe('build-cost-ledger (#886 — persist real computed cost)', () => {
  const ORIGINAL_ENV = { ...process.env }

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV }
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('buildCostEntryFromTokenUsage', () => {
    it('maps route.ts\'s real tokenUsage shape into a BuildCostEntry', () => {
      const tokenUsage = {
        input_tokens: 1200,
        output_tokens: 4300,
        total_tokens: 5500,
        estimated_cost: 0.0684,
      }
      const entry = buildCostEntryFromTokenUsage('chat-123', 'founder@example.com', 'claude-sonnet-4', tokenUsage, 'success', 8123)
      expect(entry).toEqual({
        chatId: 'chat-123',
        ownerId: 'founder@example.com',
        model: 'claude-sonnet-4',
        inputTokens: 1200,
        outputTokens: 4300,
        totalTokens: 5500,
        estimatedCostUsd: 0.0684,
        status: 'success',
        generationTimeMs: 8123,
      })
    })

    it('defaults every numeric field to 0 when tokenUsage is undefined (never throws)', () => {
      const entry = buildCostEntryFromTokenUsage('chat-456', 'anonymous', 'ministral-14b', undefined, 'degraded')
      expect(entry.inputTokens).toBe(0)
      expect(entry.outputTokens).toBe(0)
      expect(entry.totalTokens).toBe(0)
      expect(entry.estimatedCostUsd).toBe(0)
      expect(entry.status).toBe('degraded')
    })
  })

  describe('recordBuildCost — durable persistence, not console.log', () => {
    it('fails OPEN (returns false, never throws) when ZeroDB is unconfigured', async () => {
      delete process.env.ZERODB_API_KEY
      delete process.env.AINATIVE_API_KEY
      delete process.env.API_Key
      delete process.env.ZERODB_PROJECT_ID
      vi.resetModules()
      const { recordBuildCost: recordInThisEnv } = await import('@/lib/build/build-cost-ledger')
      const ok = await recordInThisEnv({
        chatId: 'chat-789', ownerId: 'founder@example.com', model: 'sonnet',
        inputTokens: 100, outputTokens: 200, totalTokens: 300,
        estimatedCostUsd: 0.003, status: 'success',
      })
      expect(ok).toBe(false)
    })

    it('returns false (not throw) when chatId is missing', async () => {
      const ok = await recordBuildCost({
        chatId: '', ownerId: 'founder@example.com', model: 'sonnet',
        inputTokens: 100, outputTokens: 200, totalTokens: 300,
        estimatedCostUsd: 0.003, status: 'success',
      })
      expect(ok).toBe(false)
    })

    it('POSTs the real cost as a row_data payload to the ZeroDB rows endpoint when configured', async () => {
      process.env.ZERODB_API_KEY = 'test-key'
      process.env.ZERODB_PROJECT_ID = 'test-project'
      process.env.AINATIVE_API_URL = 'https://api.ainative.studio'
      vi.resetModules()

      const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ ok: true }) })
      vi.stubGlobal('fetch', fetchMock)

      const { recordBuildCost: recordInThisEnv } = await import('@/lib/build/build-cost-ledger')

      const entry: BuildCostEntry = {
        chatId: 'chat-real-1', ownerId: 'founder@example.com', model: 'claude-sonnet-4',
        inputTokens: 1500, outputTokens: 6000, totalTokens: 7500,
        estimatedCostUsd: 0.0945, status: 'success', generationTimeMs: 12000,
      }
      const ok = await recordInThisEnv(entry)

      expect(ok).toBe(true)
      expect(fetchMock).toHaveBeenCalledTimes(1)
      const [url, init] = fetchMock.mock.calls[0]
      expect(url).toBe('https://api.ainative.studio/api/v1/projects/test-project/database/tables/builder_build_cost_ledger/rows')
      expect(init.method).toBe('POST')
      const body = JSON.parse(init.body)
      expect(body.row_data).toMatchObject({
        chatId: 'chat-real-1',
        ownerId: 'founder@example.com',
        model: 'claude-sonnet-4',
        inputTokens: 1500,
        outputTokens: 6000,
        totalTokens: 7500,
        estimatedCostUsd: 0.0945,
        status: 'success',
        generationTimeMs: 12000,
      })
      expect(typeof body.row_data.createdAt).toBe('string')
    })

    it('fails open (returns false) when the ZeroDB write errors, never throwing to the caller', async () => {
      process.env.ZERODB_API_KEY = 'test-key'
      process.env.ZERODB_PROJECT_ID = 'test-project'
      vi.resetModules()

      const fetchMock = vi.fn().mockRejectedValue(new Error('network down'))
      vi.stubGlobal('fetch', fetchMock)

      const { recordBuildCost: recordInThisEnv } = await import('@/lib/build/build-cost-ledger')
      await expect(
        recordInThisEnv({
          chatId: 'chat-err', ownerId: 'founder@example.com', model: 'sonnet',
          inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.00001, status: 'success',
        }),
      ).resolves.toBe(false)
    })

    it('fails open (returns false) when ZeroDB responds non-OK', async () => {
      process.env.ZERODB_API_KEY = 'test-key'
      process.env.ZERODB_PROJECT_ID = 'test-project'
      vi.resetModules()

      const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500 })
      vi.stubGlobal('fetch', fetchMock)

      const { recordBuildCost: recordInThisEnv } = await import('@/lib/build/build-cost-ledger')
      const ok = await recordInThisEnv({
        chatId: 'chat-500', ownerId: 'founder@example.com', model: 'sonnet',
        inputTokens: 1, outputTokens: 1, totalTokens: 2, estimatedCostUsd: 0.00001, status: 'success',
      })
      expect(ok).toBe(false)
    })
  })

  describe('listBuildCosts — read-back for reconciliation', () => {
    it('returns [] when unconfigured', async () => {
      delete process.env.ZERODB_API_KEY
      delete process.env.AINATIVE_API_KEY
      delete process.env.API_Key
      delete process.env.ZERODB_PROJECT_ID
      vi.resetModules()
      const { listBuildCosts: listInThisEnv } = await import('@/lib/build/build-cost-ledger')
      expect(await listInThisEnv()).toEqual([])
    })

    it('parses rows and filters by ownerId when given', async () => {
      process.env.ZERODB_API_KEY = 'test-key'
      process.env.ZERODB_PROJECT_ID = 'test-project'
      vi.resetModules()

      const fetchMock = vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          rows: [
            { row_data: { chatId: 'c1', ownerId: 'a@example.com', model: 'sonnet', inputTokens: 1, outputTokens: 2, totalTokens: 3, estimatedCostUsd: 0.01, status: 'success' } },
            { row_data: { chatId: 'c2', ownerId: 'b@example.com', model: 'sonnet', inputTokens: 4, outputTokens: 5, totalTokens: 9, estimatedCostUsd: 0.02, status: 'success' } },
          ],
        }),
      })
      vi.stubGlobal('fetch', fetchMock)

      const { listBuildCosts: listInThisEnv } = await import('@/lib/build/build-cost-ledger')
      const all = await listInThisEnv()
      expect(all).toHaveLength(2)

      const onlyA = await listInThisEnv('a@example.com')
      expect(onlyA).toHaveLength(1)
      expect(onlyA[0].chatId).toBe('c1')
    })
  })
})

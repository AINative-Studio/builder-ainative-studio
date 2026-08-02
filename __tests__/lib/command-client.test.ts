import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  buildSearchParams,
  searchCommands,
  getRecentCommands,
  toggleFavorite,
  executeCommand,
} from '@/lib/client/command-client'
import type { CommandSearchQuery } from '@/lib/types/agent-commands'

/**
 * Tests for the browser-safe command client (Issue #17). This module is the
 * boundary between the Cmd+K palette and the /api/commands routes; it must
 * never import the server DB service. We mock global fetch to assert the URLs,
 * methods, and payloads it produces.
 */
function jsonResponse(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
  } as unknown as Response
}

describe('command-client', () => {
  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn())
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    vi.restoreAllMocks()
  })

  describe('buildSearchParams', () => {
    it('omits empty / falsy values', () => {
      const q: CommandSearchQuery = { query: '', sortBy: 'relevance' }
      const qs = buildSearchParams(q)
      expect(qs).toContain('sortBy=relevance')
      expect(qs).not.toContain('query=')
    })

    it('serializes tags as a comma list and booleans as flags', () => {
      const q: CommandSearchQuery = {
        query: 'pr',
        tags: ['git', 'ci'],
        builtInOnly: true,
        favoritesOnly: true,
        limit: 5,
        offset: 10,
      }
      const params = new URLSearchParams(buildSearchParams(q))
      expect(params.get('query')).toBe('pr')
      expect(params.get('tags')).toBe('git,ci')
      expect(params.get('builtInOnly')).toBe('true')
      expect(params.get('favoritesOnly')).toBe('true')
      expect(params.get('limit')).toBe('5')
      expect(params.get('offset')).toBe('10')
    })
  })

  describe('searchCommands', () => {
    it('GETs /api/commands with the query string and returns the result', async () => {
      const result = { commands: [], total: 0, searchTime: 1, fuzzyMatch: true }
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValue(jsonResponse(result))

      const out = await searchCommands({ query: 'pr', sortBy: 'relevance' })

      expect(out).toEqual(result)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toMatch(/^\/api\/commands\?/)
      expect(String(url)).toContain('query=pr')
      expect(init?.method).toBe('GET')
    })

    it('throws with the server error message on a non-ok response', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error: 'Unauthorized' }, false, 401)
      )
      await expect(searchCommands({ query: 'x' })).rejects.toThrow('Unauthorized')
    })
  })

  describe('getRecentCommands', () => {
    it('GETs /api/commands/recent and unwraps the commands array', async () => {
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValue(jsonResponse({ commands: [{ id: 1 }] }))

      const out = await getRecentCommands(5)

      expect(out).toEqual([{ id: 1 }])
      const [url] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('/api/commands/recent?limit=5')
    })

    it('defaults to an empty array when commands is missing', async () => {
      vi.mocked(fetch).mockResolvedValue(jsonResponse({}))
      const out = await getRecentCommands()
      expect(out).toEqual([])
    })
  })

  describe('toggleFavorite', () => {
    it('POSTs to the favorite endpoint and returns the new state', async () => {
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValue(jsonResponse({ isFavorite: true }))

      const out = await toggleFavorite('cmd-123')

      expect(out).toBe(true)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('/api/commands/cmd-123/favorite')
      expect(init?.method).toBe('POST')
    })
  })

  describe('executeCommand', () => {
    it('POSTs variable values and chat context to the execute endpoint', async () => {
      const state = { status: 'completed' }
      const fetchMock = vi.mocked(fetch)
      fetchMock.mockResolvedValue(jsonResponse(state))

      const out = await executeCommand('cmd-9', { baseBranch: 'main' }, { chatId: 'chat-1' })

      expect(out).toEqual(state)
      const [url, init] = fetchMock.mock.calls[0]
      expect(String(url)).toBe('/api/commands/cmd-9/execute')
      expect(init?.method).toBe('POST')
      const payload = JSON.parse(String(init?.body))
      expect(payload.variableValues).toEqual({ baseBranch: 'main' })
      expect(payload.chatId).toBe('chat-1')
    })

    it('surfaces validation errors as a thrown error', async () => {
      vi.mocked(fetch).mockResolvedValue(
        jsonResponse({ error: 'Validation failed' }, false, 400)
      )
      await expect(
        executeCommand('cmd-9', {})
      ).rejects.toThrow('Validation failed')
    })
  })
})

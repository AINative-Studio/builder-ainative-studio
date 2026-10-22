import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/ainative/link-project.ts creates a core Project for a freshly generated
 * app. It is explicitly fire-and-forget: a linking failure must never surface
 * as a hard error to the generation flow, so every failure path returns
 * { ok: false, ... } rather than throwing. We mock fetch and the workspace
 * switcher helper at the boundary and exercise every branch.
 */

vi.mock('@/components/workspace-switcher', () => ({
  getActiveWorkspaceId: vi.fn(),
}))

import { getActiveWorkspaceId } from '@/components/workspace-switcher'
import { projectNameFromPrompt, createProjectForApp } from '@/lib/ainative/link-project'

describe('#1201 lib/ainative/link-project', () => {
  describe('projectNameFromPrompt', () => {
    it('returns "Untitled App" for an empty or whitespace-only prompt', () => {
      expect(projectNameFromPrompt('')).toBe('Untitled App')
      expect(projectNameFromPrompt('   ')).toBe('Untitled App')
      expect(projectNameFromPrompt(undefined as unknown as string)).toBe('Untitled App')
    })

    it('collapses internal whitespace and trims the result', () => {
      expect(projectNameFromPrompt('  build   me   a   crm  ')).toBe('Build me a crm')
    })

    it('takes only the first clause, splitting on ./!/?/newline', () => {
      expect(projectNameFromPrompt('build a todo app. it should sync.')).toBe(
        'Build a todo app'
      )
      expect(projectNameFromPrompt('make a game! with levels')).toBe('Make a game')
      expect(projectNameFromPrompt('what should it do?\nsomething else')).toBe(
        'What should it do'
      )
    })

    it('truncates with an ellipsis when the first clause exceeds 60 characters', () => {
      const longPrompt = 'a'.repeat(80)
      const result = projectNameFromPrompt(longPrompt)
      expect(result.length).toBe(58) // 57 chars + ellipsis
      expect(result.endsWith('…')).toBe(true)
    })

    it('capitalizes only the first letter, leaving the rest of the casing intact', () => {
      expect(projectNameFromPrompt('aLReady WeIrD casing')).toBe('ALReady WeIrD casing')
    })
  })

  describe('createProjectForApp', () => {
    beforeEach(() => {
      vi.clearAllMocks()
      vi.stubGlobal('fetch', vi.fn())
    })

    it('returns ok:true with the created project id on success', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ project: { id: 'proj-123' } }),
      } as Response)

      const result = await createProjectForApp({ prompt: 'build a crm', chatId: 'chat-1' })

      expect(result).toEqual({ ok: true, projectId: 'proj-123' })
      expect(fetch).toHaveBeenCalledWith(
        '/api/projects',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      )
      const [, init] = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body).toEqual({
        name: 'Build a crm',
        description: 'build a crm',
        workspaceId: 'ws-1',
        chatId: 'chat-1',
      })
    })

    it('omits workspaceId when getActiveWorkspaceId returns null', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue(null)
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ project: { id: 'proj-2' } }),
      } as Response)

      await createProjectForApp({ prompt: 'anything' })

      const [, init] = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.workspaceId).toBeUndefined()
    })

    it('truncates the description to 1000 characters and omits it when the prompt is empty', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ project: { id: 'proj-3' } }),
      } as Response)

      const longPrompt = 'x'.repeat(1500)
      await createProjectForApp({ prompt: longPrompt })
      const [, init] = vi.mocked(fetch).mock.calls[0]
      const body = JSON.parse((init as RequestInit).body as string)
      expect(body.description.length).toBe(1000)

      vi.mocked(fetch).mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ project: { id: 'proj-4' } }),
      } as Response)
      await createProjectForApp({ prompt: '' })
      const [, init2] = vi.mocked(fetch).mock.calls[1]
      const body2 = JSON.parse((init2 as RequestInit).body as string)
      expect(body2.description).toBeUndefined()
    })

    it('silently no-ops on a 401 (no AINative session) rather than surfacing an error', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue(null)
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 401,
        json: async () => ({}),
      } as Response)

      const result = await createProjectForApp({ prompt: 'build something' })
      expect(result).toEqual({ ok: false })
    })

    it('surfaces upgradeRequired and the max cap when the Hobbyist project cap is hit', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 403,
        json: async () => ({ upgradeRequired: true, max: 3 }),
      } as Response)

      const result = await createProjectForApp({ prompt: 'one more app' })
      expect(result).toEqual({ ok: false, upgradeRequired: true, max: 3 })
    })

    it('returns the server-provided error message on a generic failure', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({ error: 'internal boom' }),
      } as Response)

      const result = await createProjectForApp({ prompt: 'x' })
      expect(result).toEqual({ ok: false, error: 'internal boom' })
    })

    it('falls back to a status-coded message when the error body has no error field', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({}),
      } as Response)

      const result = await createProjectForApp({ prompt: 'x' })
      expect(result).toEqual({ ok: false, error: 'Failed (502)' })
    })

    it('tolerates a response whose body is not valid JSON', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => {
          throw new Error('not json')
        },
      } as unknown as Response)

      const result = await createProjectForApp({ prompt: 'x' })
      expect(result).toEqual({ ok: false, error: 'Failed (500)' })
    })

    it('catches a network failure and returns its message', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockRejectedValue(new Error('network down'))

      const result = await createProjectForApp({ prompt: 'x' })
      expect(result).toEqual({ ok: false, error: 'network down' })
    })

    it('falls back to a generic message when a non-Error is thrown', async () => {
      vi.mocked(getActiveWorkspaceId).mockReturnValue('ws-1')
      vi.mocked(fetch).mockRejectedValue('weird throw')

      const result = await createProjectForApp({ prompt: 'x' })
      expect(result).toEqual({ ok: false, error: 'Request failed' })
    })
  })
})

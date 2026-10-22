import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/ainative/workspaces.ts is a thin client over the core workspace API.
 * Every user has a permanent default workspace, so getDefaultWorkspace's
 * empty-list and no-default-flag fallback paths matter for correctness.
 * We mock ainativeFetch at the module boundary — no real network calls.
 */

vi.mock('@/lib/ainative/client', () => ({
  ainativeFetch: vi.fn(),
}))

import { ainativeFetch } from '@/lib/ainative/client'
import {
  listWorkspaces,
  getDefaultWorkspace,
  createWorkspace,
} from '@/lib/ainative/workspaces'
import type { Workspace } from '@/lib/ainative/types'

function makeWorkspace(overrides: Partial<Workspace> = {}): Workspace {
  return {
    id: 'ws-1',
    name: 'My Workspace',
    is_default: false,
    ...overrides,
  } as Workspace
}

describe('#1201 lib/ainative/workspaces', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listWorkspaces', () => {
    it('returns the workspaces array from a successful response', async () => {
      const workspaces = [makeWorkspace({ id: 'a' }), makeWorkspace({ id: 'b' })]
      vi.mocked(ainativeFetch).mockResolvedValue({ workspaces })

      const result = await listWorkspaces('token-123')

      expect(result).toEqual(workspaces)
      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/workspaces', 'token-123')
    })

    it('returns an empty array when the response has no workspaces field', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue({} as never)
      const result = await listWorkspaces('token-123')
      expect(result).toEqual([])
    })

    it('returns an empty array when the response itself is null/undefined', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue(null as never)
      const result = await listWorkspaces('token-123')
      expect(result).toEqual([])
    })
  })

  describe('getDefaultWorkspace', () => {
    it('returns null when the user has no workspaces at all', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue({ workspaces: [] })
      const result = await getDefaultWorkspace('token-123')
      expect(result).toBeNull()
    })

    it('returns the workspace flagged is_default when present', async () => {
      const defaultWs = makeWorkspace({ id: 'default-ws', is_default: true })
      vi.mocked(ainativeFetch).mockResolvedValue({
        workspaces: [makeWorkspace({ id: 'other' }), defaultWs],
      })

      const result = await getDefaultWorkspace('token-123')
      expect(result).toEqual(defaultWs)
    })

    it('falls back to the first workspace when none is flagged is_default', async () => {
      const first = makeWorkspace({ id: 'first', is_default: false })
      const second = makeWorkspace({ id: 'second', is_default: false })
      vi.mocked(ainativeFetch).mockResolvedValue({ workspaces: [first, second] })

      const result = await getDefaultWorkspace('token-123')
      expect(result).toEqual(first)
    })
  })

  describe('createWorkspace', () => {
    it('posts the input and returns the created workspace', async () => {
      const created = makeWorkspace({ id: 'new-ws', name: 'New Co' })
      vi.mocked(ainativeFetch).mockResolvedValue({ ok: true, workspace: created })

      const result = await createWorkspace('token-123', { name: 'New Co' })

      expect(result).toEqual(created)
      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/workspaces', 'token-123', {
        method: 'POST',
        body: { name: 'New Co' },
      })
    })
  })
})

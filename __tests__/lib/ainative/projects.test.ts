import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Issue #1201 — Coverage Phase 1 follow-up.
 *
 * lib/ainative/projects.ts is a thin client over the core project API — in
 * the builder, each generated app IS a core Project. We mock ainativeFetch
 * at the module boundary (no real network calls) and exercise the
 * defensive bare-array-vs-wrapped-shape tolerance, workspace filtering,
 * tier defaulting on create, and the Hobbyist cap helper.
 */

vi.mock('@/lib/ainative/client', () => ({
  ainativeFetch: vi.fn(),
}))

import { ainativeFetch } from '@/lib/ainative/client'
import {
  listProjects,
  listProjectsForWorkspace,
  getProject,
  createProject,
  deleteProject,
  hobbyistProjectsRemaining,
  freeTierProjectsRemaining,
} from '@/lib/ainative/projects'
import type { Project } from '@/lib/ainative/types'

function makeProject(overrides: Partial<Project> = {}): Project {
  return {
    id: 'proj-1',
    name: 'My App',
    organization_id: 'org-1',
    ...overrides,
  } as Project
}

describe('#1201 lib/ainative/projects', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('listProjects', () => {
    it('returns the array as-is when core responds with a bare array', async () => {
      const projects = [makeProject({ id: 'a' }), makeProject({ id: 'b' })]
      vi.mocked(ainativeFetch).mockResolvedValue(projects)

      const result = await listProjects('token')
      expect(result).toEqual(projects)
      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/projects', 'token')
    })

    it('unwraps a { projects } wrapped shape defensively', async () => {
      const projects = [makeProject({ id: 'c' })]
      vi.mocked(ainativeFetch).mockResolvedValue({ projects })

      const result = await listProjects('token')
      expect(result).toEqual(projects)
    })

    it('returns an empty array when the wrapped shape has no projects field', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue({} as never)
      const result = await listProjects('token')
      expect(result).toEqual([])
    })

    it('returns an empty array when the response is null', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue(null as never)
      const result = await listProjects('token')
      expect(result).toEqual([])
    })
  })

  describe('listProjectsForWorkspace', () => {
    it('filters projects down to the given organization id', async () => {
      const projects = [
        makeProject({ id: 'a', organization_id: 'org-1' }),
        makeProject({ id: 'b', organization_id: 'org-2' }),
        makeProject({ id: 'c', organization_id: 'org-1' }),
      ]
      vi.mocked(ainativeFetch).mockResolvedValue(projects)

      const result = await listProjectsForWorkspace('token', 'org-1')
      expect(result.map((p) => p.id)).toEqual(['a', 'c'])
    })

    it('returns an empty array when no project matches the workspace', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue([makeProject({ organization_id: 'other' })])
      const result = await listProjectsForWorkspace('token', 'org-1')
      expect(result).toEqual([])
    })
  })

  describe('getProject', () => {
    it('fetches a single project by id', async () => {
      const project = makeProject({ id: 'proj-42' })
      vi.mocked(ainativeFetch).mockResolvedValue(project)

      const result = await getProject('token', 'proj-42')
      expect(result).toEqual(project)
      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/projects/proj-42', 'token')
    })
  })

  describe('createProject', () => {
    it('defaults database_enabled:true and tier:hobbyist when not specified', async () => {
      const created = makeProject({ id: 'new' })
      vi.mocked(ainativeFetch).mockResolvedValue(created)

      const result = await createProject('token', { name: 'New App' } as never)

      expect(result).toEqual(created)
      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/projects', 'token', {
        method: 'POST',
        body: {
          database_enabled: true,
          tier: 'hobbyist',
          name: 'New App',
        },
      })
    })

    it('lets a caller-supplied tier override the hobbyist default', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue(makeProject())

      await createProject('token', { name: 'Paid App', tier: 'pro' } as never)

      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/projects', 'token', {
        method: 'POST',
        body: expect.objectContaining({ tier: 'pro' }),
      })
    })
  })

  describe('deleteProject', () => {
    it('sends a DELETE request for the given project id', async () => {
      vi.mocked(ainativeFetch).mockResolvedValue(undefined)

      await deleteProject('token', 'proj-99')

      expect(ainativeFetch).toHaveBeenCalledWith('/api/v1/projects/proj-99', 'token', {
        method: 'DELETE',
      })
    })
  })

  describe('hobbyistProjectsRemaining / freeTierProjectsRemaining', () => {
    it('returns the remaining count under the cap', () => {
      expect(hobbyistProjectsRemaining(0)).toBe(3)
      expect(hobbyistProjectsRemaining(1)).toBe(2)
    })

    it('clamps to zero rather than going negative once at or over the cap', () => {
      expect(hobbyistProjectsRemaining(3)).toBe(0)
      expect(hobbyistProjectsRemaining(10)).toBe(0)
    })

    it('exposes the deprecated alias with identical behavior', () => {
      expect(freeTierProjectsRemaining).toBe(hobbyistProjectsRemaining)
      expect(freeTierProjectsRemaining(2)).toBe(1)
    })
  })
})

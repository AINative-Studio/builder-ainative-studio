import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'
import { GET, POST } from '@/app/api/skills/route'
import { GET as GET_SKILL, PATCH, DELETE } from '@/app/api/skills/[skillId]/route'

// Mock the auth module
vi.mock('@/app/(auth)/auth', () => ({
  auth: vi.fn(),
}))

// Mock the database queries
vi.mock('@/lib/db/queries', () => ({
  getAllActiveSkills: vi.fn(),
  getBuiltInSkills: vi.fn(),
  createSkill: vi.fn(),
  getSkillById: vi.fn(),
  updateSkill: vi.fn(),
  deleteSkill: vi.fn(),
}))

describe('Skills API', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('GET /api/skills', () => {
    it('should return unauthorized if not authenticated', async () => {
      const { auth } = await import('@/app/(auth)/auth')
      vi.mocked(auth).mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3000/api/skills')
      const response = await GET(request)

      expect(response.status).toBe(401)
      const data = await response.json()
      expect(data.error).toBe('Unauthorized')
    })

    it('should return all active skills', async () => {
      const mockSkills = [
        {
          id: 'test-skill',
          name: 'Test Skill',
          description: 'A test skill',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          tags: ['test'],
        },
      ]

      const { auth } = await import('@/app/(auth)/auth')
      const { getAllActiveSkills } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getAllActiveSkills).mockResolvedValue(mockSkills as any)

      const request = new NextRequest('http://localhost:3000/api/skills')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.skills).toHaveLength(1)
      expect(data.skills[0].id).toBe('test-skill')
    })

    it('should return only built-in skills when builtInOnly=true', async () => {
      const mockBuiltInSkills = [
        {
          id: 'built-in-skill',
          name: 'Built-in Skill',
          is_built_in: true,
        },
      ]

      const { auth } = await import('@/app/(auth)/auth')
      const { getBuiltInSkills } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getBuiltInSkills).mockResolvedValue(mockBuiltInSkills as any)

      const request = new NextRequest('http://localhost:3000/api/skills?builtInOnly=true')
      const response = await GET(request)

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.skills).toHaveLength(1)
      expect(vi.mocked(getBuiltInSkills)).toHaveBeenCalled()
    })
  })

  describe('POST /api/skills', () => {
    it('should create a new skill', async () => {
      const newSkill = {
        id: 'new-skill',
        name: 'New Skill',
        description: 'A new skill',
        version: '1.0.0',
        tags: ['test', 'new'],
        content: '# New Skill Content',
      }

      const createdSkill = {
        ...newSkill,
        author_id: 'user-1',
        author_name: 'test@example.com',
        created_at: new Date(),
        updated_at: new Date(),
      }

      const { auth } = await import('@/app/(auth)/auth')
      const { createSkill } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(createSkill).mockResolvedValue([createdSkill] as any)

      const request = new NextRequest('http://localhost:3000/api/skills', {
        method: 'POST',
        body: JSON.stringify(newSkill),
      })
      const response = await POST(request)

      expect(response.status).toBe(201)
      const data = await response.json()
      expect(data.skill.id).toBe('new-skill')
      expect(vi.mocked(createSkill)).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'new-skill',
          name: 'New Skill',
          authorId: 'user-1',
        })
      )
    })

    it('should return validation error for invalid data', async () => {
      const { auth } = await import('@/app/(auth)/auth')
      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)

      const invalidSkill = {
        id: 'invalid',
        name: '',  // Empty name should fail validation
        description: 'Description',
        version: 'not-semver',  // Invalid version
        tags: [],  // Empty tags
        content: '',  // Empty content
      }

      const request = new NextRequest('http://localhost:3000/api/skills', {
        method: 'POST',
        body: JSON.stringify(invalidSkill),
      })
      const response = await POST(request)

      expect(response.status).toBe(400)
      const data = await response.json()
      expect(data.error).toBe('Validation error')
    })
  })

  describe('GET /api/skills/[skillId]', () => {
    it('should return a specific skill', async () => {
      const mockSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'Description',
        content: '# Test Content',
        version: '1.0.0',
        author_id: 'user-1',
        author_name: 'User 1',
      }

      const { auth } = await import('@/app/(auth)/auth')
      const { getSkillById } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getSkillById).mockResolvedValue(mockSkill as any)

      const request = new NextRequest('http://localhost:3000/api/skills/test-skill')
      const response = await GET_SKILL(request, { params: { skillId: 'test-skill' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.skill.id).toBe('test-skill')
    })

    it('should return 404 when skill not found', async () => {
      const { auth } = await import('@/app/(auth)/auth')
      const { getSkillById } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getSkillById).mockResolvedValue(null)

      const request = new NextRequest('http://localhost:3000/api/skills/nonexistent')
      const response = await GET_SKILL(request, { params: { skillId: 'nonexistent' } })

      expect(response.status).toBe(404)
      const data = await response.json()
      expect(data.error).toBe('Skill not found')
    })
  })

  describe('PATCH /api/skills/[skillId]', () => {
    it('should update a skill', async () => {
      const mockSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        author_id: 'user-1',
        is_built_in: false,
      }

      const updatedSkill = {
        ...mockSkill,
        name: 'Updated Skill',
      }

      const { auth } = await import('@/app/(auth)/auth')
      const { getSkillById, updateSkill } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getSkillById).mockResolvedValue(mockSkill as any)
      vi.mocked(updateSkill).mockResolvedValue([updatedSkill] as any)

      const request = new NextRequest('http://localhost:3000/api/skills/test-skill', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated Skill' }),
      })
      const response = await PATCH(request, { params: { skillId: 'test-skill' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.skill.name).toBe('Updated Skill')
    })

    it('should return 403 when user is not the author', async () => {
      const mockSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        author_id: 'other-user',
        is_built_in: false,
      }

      const { auth } = await import('@/app/(auth)/auth')
      const { getSkillById } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getSkillById).mockResolvedValue(mockSkill as any)

      const request = new NextRequest('http://localhost:3000/api/skills/test-skill', {
        method: 'PATCH',
        body: JSON.stringify({ name: 'Updated' }),
      })
      const response = await PATCH(request, { params: { skillId: 'test-skill' } })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Forbidden')
    })
  })

  describe('DELETE /api/skills/[skillId]', () => {
    it('should delete a skill', async () => {
      const mockSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        author_id: 'user-1',
        is_built_in: false,
      }

      const { auth } = await import('@/app/(auth)/auth')
      const { getSkillById, deleteSkill } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getSkillById).mockResolvedValue(mockSkill as any)
      vi.mocked(deleteSkill).mockResolvedValue(undefined)

      const request = new NextRequest('http://localhost:3000/api/skills/test-skill', {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { skillId: 'test-skill' } })

      expect(response.status).toBe(200)
      const data = await response.json()
      expect(data.success).toBe(true)
    })

    it('should not delete built-in skills', async () => {
      const mockSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        author_id: 'user-1',
        is_built_in: true,
      }

      const { auth } = await import('@/app/(auth)/auth')
      const { getSkillById } = await import('@/lib/db/queries')

      vi.mocked(auth).mockResolvedValue({ user: { id: 'user-1', email: 'test@example.com' } } as any)
      vi.mocked(getSkillById).mockResolvedValue(mockSkill as any)

      const request = new NextRequest('http://localhost:3000/api/skills/test-skill', {
        method: 'DELETE',
      })
      const response = await DELETE(request, { params: { skillId: 'test-skill' } })

      expect(response.status).toBe(403)
      const data = await response.json()
      expect(data.error).toBe('Cannot delete built-in skills')
    })
  })
})

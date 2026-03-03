import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentSkillService } from '@/lib/services/agent-skill.service'
import type { SkillContext, SkillMetadata } from '@/lib/types/agent-skills'

// Mock the database queries
vi.mock('@/lib/db/queries', () => ({
  getSkillById: vi.fn(),
  getAllActiveSkills: vi.fn(),
}))

describe('AgentSkillService', () => {
  let service: AgentSkillService

  beforeEach(() => {
    service = new AgentSkillService()
    vi.clearAllMocks()
  })

  describe('loadMetadata', () => {
    it('should load skill metadata', async () => {
      const mockSkill = {
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        version: '1.0.0',
        author_id: 'user-1',
        author_name: 'Test User',
        author_email: 'test@example.com',
        tags: ['test', 'demo'],
        trigger_patterns: ['test pattern'],
        dependencies: [],
        token_cost_metadata: 100,
        token_cost_full: 2000,
        compatibility: null,
        content: 'Test content',
        references: null,
        examples: null,
        validation_rules: null,
        commands: null,
        is_built_in: false,
        is_active: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      }

      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(mockSkill)

      const metadata = await service.loadMetadata('test-skill')

      expect(metadata).toEqual({
        id: 'test-skill',
        name: 'Test Skill',
        description: 'A test skill',
        version: '1.0.0',
        author: {
          id: 'user-1',
          name: 'Test User',
          email: 'test@example.com',
        },
        tags: ['test', 'demo'],
        triggerPatterns: ['test pattern'],
        dependencies: [],
        tokenCost: {
          metadata: 100,
          full: 2000,
        },
        compatibility: undefined,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-01'),
      })
    })

    it('should throw error when skill not found', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(null)

      await expect(service.loadMetadata('nonexistent')).rejects.toThrow(
        'Skill not found: nonexistent'
      )
    })
  })

  describe('searchSkills', () => {
    it('should search and filter skills', async () => {
      const mockSkills = [
        {
          id: 'skill-1',
          name: 'Git Workflow',
          description: 'Git workflow skill',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['git', 'workflow'],
          trigger_patterns: null,
          dependencies: null,
          token_cost_metadata: 100,
          token_cost_full: 2000,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'skill-2',
          name: 'Testing Guide',
          description: 'Testing best practices',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['testing', 'tdd'],
          trigger_patterns: null,
          dependencies: null,
          token_cost_metadata: 150,
          token_cost_full: 2500,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        },
      ]

      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue(mockSkills)

      const result = await service.searchSkills({ query: 'git' })

      expect(result.skills).toHaveLength(1)
      expect(result.skills[0].name).toBe('Git Workflow')
      expect(result.total).toBe(1)
      expect(result.searchTime).toBeGreaterThan(0)
    })

    it('should filter by tags', async () => {
      const mockSkills = [
        {
          id: 'skill-1',
          name: 'Skill 1',
          description: 'Description 1',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['git', 'workflow'],
          trigger_patterns: null,
          dependencies: null,
          token_cost_metadata: 100,
          token_cost_full: 2000,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'skill-2',
          name: 'Skill 2',
          description: 'Description 2',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['testing', 'tdd'],
          trigger_patterns: null,
          dependencies: null,
          token_cost_metadata: 150,
          token_cost_full: 2500,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        },
      ]

      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue(mockSkills)

      const result = await service.searchSkills({ tags: ['testing'] })

      expect(result.skills).toHaveLength(1)
      expect(result.skills[0].id).toBe('skill-2')
    })

    it('should sort skills by name', async () => {
      const mockSkills = [
        {
          id: 'skill-b',
          name: 'B Skill',
          description: 'Description',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['tag'],
          trigger_patterns: null,
          dependencies: null,
          token_cost_metadata: 100,
          token_cost_full: 2000,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
        {
          id: 'skill-a',
          name: 'A Skill',
          description: 'Description',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['tag'],
          trigger_patterns: null,
          dependencies: null,
          token_cost_metadata: 100,
          token_cost_full: 2000,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-02'),
          updated_at: new Date('2024-01-02'),
        },
      ]

      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue(mockSkills)

      const result = await service.searchSkills({ sortBy: 'name' })

      expect(result.skills[0].name).toBe('A Skill')
      expect(result.skills[1].name).toBe('B Skill')
    })

    it('should apply pagination', async () => {
      const mockSkills = Array.from({ length: 10 }, (_, i) => ({
        id: `skill-${i}`,
        name: `Skill ${i}`,
        description: 'Description',
        version: '1.0.0',
        author_id: 'user-1',
        author_name: 'User 1',
        author_email: null,
        tags: ['tag'],
        trigger_patterns: null,
        dependencies: null,
        token_cost_metadata: 100,
        token_cost_full: 2000,
        compatibility: null,
        content: 'Content',
        references: null,
        examples: null,
        validation_rules: null,
        commands: null,
        is_built_in: true,
        is_active: true,
        created_at: new Date('2024-01-01'),
        updated_at: new Date('2024-01-01'),
      }))

      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue(mockSkills)

      const result = await service.searchSkills({ limit: 5, offset: 0 })

      expect(result.skills).toHaveLength(5)
      expect(result.total).toBe(10)
    })
  })

  describe('calculateTokenUsage', () => {
    it('should calculate token usage for loaded skills', () => {
      // Load a skill first (mock the state)
      service['loadedSkills'].set('skill-1', {
        metadata: {
          id: 'skill-1',
          name: 'Test Skill',
          description: 'Description',
          version: '1.0.0',
          author: { id: 'user-1', name: 'User 1' },
          tags: ['test'],
          tokenCost: { metadata: 100, full: 2000 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        content: 'Content',
      })

      service['skillStates'].set('skill-1', {
        skillId: 'skill-1',
        metadataLoaded: true,
        contentLoaded: true,
        referencesLoaded: false,
        loadedAt: new Date(),
        loadTime: 50,
      })

      const usage = service.calculateTokenUsage()

      expect(usage.metadata).toBe(100)
      expect(usage.content).toBe(2000)
      expect(usage.total).toBe(2100)
    })

    it('should only count metadata tokens when content not loaded', () => {
      service['loadedSkills'].set('skill-1', {
        metadata: {
          id: 'skill-1',
          name: 'Test Skill',
          description: 'Description',
          version: '1.0.0',
          author: { id: 'user-1', name: 'User 1' },
          tags: ['test'],
          tokenCost: { metadata: 100, full: 2000 },
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        content: 'Content',
      })

      service['skillStates'].set('skill-1', {
        skillId: 'skill-1',
        metadataLoaded: true,
        contentLoaded: false,
        referencesLoaded: false,
        loadedAt: new Date(),
        loadTime: 50,
      })

      const usage = service.calculateTokenUsage()

      expect(usage.metadata).toBe(100)
      expect(usage.content).toBe(0)
      expect(usage.total).toBe(100)
    })
  })

  describe('recommendSkills', () => {
    it('should recommend skills based on context', async () => {
      const mockSkills = [
        {
          id: 'git-workflow',
          name: 'Git Workflow',
          description: 'Git workflow best practices',
          version: '1.0.0',
          author_id: 'user-1',
          author_name: 'User 1',
          author_email: null,
          tags: ['git', 'commit'],
          trigger_patterns: ['commit', 'git'],
          dependencies: null,
          token_cost_metadata: 100,
          token_cost_full: 2000,
          compatibility: null,
          content: 'Content',
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          is_built_in: true,
          is_active: true,
          created_at: new Date('2024-01-01'),
          updated_at: new Date('2024-01-01'),
        },
      ]

      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue(mockSkills)

      const context: SkillContext = {
        sessionId: 'session-1',
        userId: 'user-1',
        recentMessages: ['I need to commit my changes'],
        gitContext: {
          branch: 'main',
          hasUncommittedChanges: true,
        },
      }

      const recommendations = await service.recommendSkills(context)

      expect(recommendations).toHaveLength(1)
      expect(recommendations[0].skill.id).toBe('git-workflow')
      expect(recommendations[0].confidence).toBeGreaterThan(0)
      expect(recommendations[0].reason).toContain('commit')
    })
  })

  describe('getLoadedSkillsState', () => {
    it('should return loaded skills state', () => {
      service['skillStates'].set('skill-1', {
        skillId: 'skill-1',
        metadataLoaded: true,
        contentLoaded: true,
        referencesLoaded: false,
        loadedAt: new Date(),
        loadTime: 50,
      })

      const states = service.getLoadedSkillsState()

      expect(states).toHaveLength(1)
      expect(states[0].skillId).toBe('skill-1')
      expect(states[0].metadataLoaded).toBe(true)
      expect(states[0].contentLoaded).toBe(true)
    })
  })
})

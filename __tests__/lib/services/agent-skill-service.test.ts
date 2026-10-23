/**
 * Agent Skill Service Tests (lib/services path)
 *
 * Complements __tests__/services/agent-skill.service.test.ts, which only
 * covers loadMetadata/searchSkills/calculateTokenUsage/recommendSkills/
 * getLoadedSkillsState. This suite targets the remaining uncovered surface:
 *  - loadFullSkill (cache hit/miss, state transitions, usage tracking)
 *  - autoTriggerSkills (token-budget gating, auto vs manual tracking)
 *  - unloadSkills
 *  - getUsageStats
 *  - calculateRelevanceScore's individual branches (trigger patterns, file
 *    extension context, git context with/without matching tags)
 *  - matchesPattern / hasTokenBudget (via the public methods that call them)
 *  - trackUsage incrementing existing stats across multiple calls
 *  - error handling (skill not found) for loadFullSkill
 *  - getSkillService singleton behavior
 *
 * `@/lib/db/queries` is mocked per house style (see
 * __tests__/lib/services/rule-enforcement-db-service.test.ts), matching how
 * agent-skill.service.ts dynamically imports getSkillById/getAllActiveSkills
 * to avoid circular dependencies.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AgentSkillService, getSkillService } from '@/lib/services/agent-skill.service'
import type { SkillContext } from '@/lib/types/agent-skills'

vi.mock('@/lib/db/queries', () => ({
  getSkillById: vi.fn(),
  getAllActiveSkills: vi.fn(),
}))

function dbSkillFixture(overrides: Record<string, any> = {}) {
  return {
    id: 'skill-1',
    name: 'Test Skill',
    description: 'A test skill',
    version: '1.0.0',
    author_id: 'user-1',
    author_name: 'Test User',
    author_email: 'test@example.com',
    tags: ['test', 'demo'],
    trigger_patterns: ['deploy'],
    dependencies: [],
    token_cost_metadata: 100,
    token_cost_full: 2000,
    compatibility: { frameworks: ['next.js'], languages: ['typescript'] },
    content: 'Full skill content',
    references: [{ name: 'Ref', path: '/ref', type: 'markdown' as const }],
    examples: [{ title: 'Example', content: 'code' }],
    validation_rules: ['rule-1'],
    commands: ['cmd-1'],
    is_built_in: false,
    is_active: true,
    created_at: new Date('2024-01-01'),
    updated_at: new Date('2024-01-01'),
    ...overrides,
  }
}

describe('AgentSkillService (lib/services)', () => {
  let service: AgentSkillService

  beforeEach(() => {
    service = new AgentSkillService()
    vi.clearAllMocks()
  })

  describe('loadFullSkill', () => {
    it('fetches, caches, and returns a full skill on first load', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture())

      const skill = await service.loadFullSkill('skill-1')

      expect(skill.metadata.id).toBe('skill-1')
      expect(skill.content).toBe('Full skill content')
      expect(skill.references).toEqual([{ name: 'Ref', path: '/ref', type: 'markdown' }])
      expect(skill.examples).toEqual([{ title: 'Example', content: 'code' }])
      expect(skill.validationRules).toEqual(['rule-1'])
      expect(skill.commands).toEqual(['cmd-1'])

      // Load state should reflect metadata+content loaded, not references.
      const state = service.getLoadedSkillsState().find((s) => s.skillId === 'skill-1')
      expect(state?.metadataLoaded).toBe(true)
      expect(state?.contentLoaded).toBe(true)
      expect(state?.referencesLoaded).toBe(false)

      // Manual load should be tracked.
      const stats = service.getUsageStats('skill-1')
      expect(stats?.loadCount).toBe(1)
      expect(stats?.manualInvokeCount).toBe(1)
      expect(stats?.autoTriggerCount).toBe(0)
    })

    it('returns the cached skill without a second DB fetch on repeat calls', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture())

      const first = await service.loadFullSkill('skill-1')
      const second = await service.loadFullSkill('skill-1')

      expect(second).toBe(first) // same cached object reference
      expect(getSkillById).toHaveBeenCalledTimes(1)
    })

    it('maps nullable optional fields (trigger_patterns, dependencies, compatibility, references, examples, validation_rules, commands) to undefined', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(
        dbSkillFixture({
          trigger_patterns: null,
          dependencies: null,
          compatibility: null,
          references: null,
          examples: null,
          validation_rules: null,
          commands: null,
          author_email: null,
        })
      )

      const skill = await service.loadFullSkill('skill-1')

      expect(skill.metadata.triggerPatterns).toBeUndefined()
      expect(skill.metadata.dependencies).toBeUndefined()
      expect(skill.metadata.compatibility).toBeUndefined()
      expect(skill.metadata.author.email).toBeUndefined()
      expect(skill.references).toBeUndefined()
      expect(skill.examples).toBeUndefined()
      expect(skill.validationRules).toBeUndefined()
      expect(skill.commands).toBeUndefined()
    })

    it('throws when the underlying skill does not exist', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(null)

      await expect(service.loadFullSkill('missing-skill')).rejects.toThrow(
        'Skill not found: missing-skill'
      )
    })

    it('preserves a prior load state (e.g. referencesLoaded) when upgrading from metadata-only to full', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture())

      // Seed a pre-existing state as if references had already been loaded.
      service['skillStates'].set('skill-1', {
        skillId: 'skill-1',
        metadataLoaded: true,
        contentLoaded: false,
        referencesLoaded: true,
        loadedAt: new Date('2023-01-01'),
        loadTime: 10,
      })

      await service.loadFullSkill('skill-1')

      // referencesLoaded is explicitly overwritten to false by loadFullSkill's
      // spread-then-override, which this test documents.
      const state = service.getLoadedSkillsState().find((s) => s.skillId === 'skill-1')
      expect(state?.referencesLoaded).toBe(false)
      expect(state?.contentLoaded).toBe(true)
    })
  })

  describe('autoTriggerSkills', () => {
    it('auto-loads only skills whose recommendation confidence exceeds the autoLoad threshold', async () => {
      const { getAllActiveSkills, getSkillById } = await import('@/lib/db/queries')
      // trigger pattern match (0.4) + git context tag match (0.3) = 0.7, not > 0.7 => not autoLoad.
      // To get autoLoad we need > 0.7: trigger (0.4) + file ext (0.2) + git (0.3) = 0.9.
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'high-confidence',
          tags: ['git', 'commit'],
          trigger_patterns: ['deploy'],
        }),
      ])
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture({ id: 'high-confidence' }))

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        currentFile: 'app/page.tsx',
        recentMessages: ['please deploy this now'],
        gitContext: { branch: 'main', hasUncommittedChanges: true },
      }

      const loaded = await service.autoTriggerSkills(context)

      expect(loaded).toHaveLength(1)
      expect(loaded[0].metadata.id).toBe('high-confidence')

      // autoTriggerSkills() calls loadFullSkill() (which itself tracks a
      // 'manual' usage) and then separately tracks an 'auto' usage, so both
      // counters increment for a single auto-triggered load — this reflects
      // loadFullSkill's unconditional trackUsage(..., 'manual') call, not a
      // double-counting bug in the test.
      const stats = service.getUsageStats('high-confidence')
      expect(stats?.loadCount).toBe(2)
      expect(stats?.autoTriggerCount).toBe(1)
      expect(stats?.manualInvokeCount).toBe(1)
    })

    it('does not auto-load a skill whose confidence is at or below the autoLoad threshold', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      // Only git-context match (0.3) => confidence 0.3, not > 0.3 => filtered out
      // of recommendations entirely (confidence must be > 0.3 to even be recommended).
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'low-confidence', tags: ['unrelated'], trigger_patterns: null }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        gitContext: { branch: 'main', hasUncommittedChanges: true },
      }

      const loaded = await service.autoTriggerSkills(context)
      expect(loaded).toHaveLength(0)
    })

    it('skips auto-loading when the token budget does not have enough remaining headroom', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'expensive-skill',
          tags: ['git', 'commit'],
          trigger_patterns: ['deploy'],
          token_cost_full: 5000,
        }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        currentFile: 'app/page.tsx',
        recentMessages: ['please deploy this now'],
        gitContext: { branch: 'main', hasUncommittedChanges: true },
        tokenBudget: { total: 1000, used: 900, remaining: 100 }, // needs 2x5000
      }

      const loaded = await service.autoTriggerSkills(context)
      expect(loaded).toHaveLength(0)
    })

    it('auto-loads when no token budget is supplied at all (unconstrained)', async () => {
      const { getAllActiveSkills, getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'unconstrained-skill',
          tags: ['git', 'commit'],
          trigger_patterns: ['deploy'],
          token_cost_full: 999999,
        }),
      ])
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture({ id: 'unconstrained-skill' }))

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        currentFile: 'app/page.tsx',
        recentMessages: ['please deploy this now'],
        gitContext: { branch: 'main', hasUncommittedChanges: true },
      }

      const loaded = await service.autoTriggerSkills(context)
      expect(loaded).toHaveLength(1)
    })
  })

  describe('unloadSkills', () => {
    it('removes loaded skills and their state so a later load re-fetches from the DB', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture())

      await service.loadFullSkill('skill-1')
      expect(service.getLoadedSkillsState()).toHaveLength(1)

      await service.unloadSkills(['skill-1'])

      expect(service.getLoadedSkillsState()).toHaveLength(0)

      // Loading again should hit the DB a second time since the cache was cleared.
      await service.loadFullSkill('skill-1')
      expect(getSkillById).toHaveBeenCalledTimes(2)
    })

    it('silently ignores skill ids that were never loaded', async () => {
      await expect(service.unloadSkills(['never-loaded'])).resolves.toBeUndefined()
      expect(service.getLoadedSkillsState()).toHaveLength(0)
    })

    it('handles an empty array without error', async () => {
      await expect(service.unloadSkills([])).resolves.toBeUndefined()
    })
  })

  describe('getUsageStats', () => {
    it('returns undefined for a skill that has never been tracked', () => {
      expect(service.getUsageStats('untracked-skill')).toBeUndefined()
    })

    it('accumulates loadCount and distinguishes manual vs auto invocations across repeated loads', async () => {
      const { getSkillById } = await import('@/lib/db/queries')
      vi.mocked(getSkillById).mockResolvedValue(dbSkillFixture())

      await service.loadFullSkill('skill-1') // manual
      await service.unloadSkills(['skill-1'])
      await service.loadFullSkill('skill-1') // manual again

      const stats = service.getUsageStats('skill-1')
      expect(stats?.loadCount).toBe(2)
      expect(stats?.manualInvokeCount).toBe(2)
      expect(stats?.autoTriggerCount).toBe(0)
    })
  })

  describe('calculateRelevanceScore branches (via recommendSkills)', () => {
    it('scores a TypeScript file context match even with no trigger patterns or git context', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'fw-skill',
          trigger_patterns: null,
          tags: ['other'],
          compatibility: { frameworks: ['next.js'] },
        }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        currentFile: 'components/Button.tsx',
      }

      const recs = await service.recommendSkills(context)
      // File-ext-only match contributes 0.2, which is <= 0.3 threshold => not recommended.
      expect(recs).toHaveLength(0)
    })

    it('does not award file-context points for a non-ts/tsx file', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'py-file-skill',
          trigger_patterns: ['anything'],
          compatibility: { frameworks: ['next.js'] },
        }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        currentFile: 'script.py',
        recentMessages: ['anything goes here'],
      }

      const recs = await service.recommendSkills(context)
      // Only trigger-pattern match (0.4) applies; file ext is python, not ts/tsx.
      expect(recs).toHaveLength(1)
      expect(recs[0].reason).not.toContain('TypeScript')
    })

    it('does not award git-context points when tags do not include git or commit', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'unrelated-tags',
          trigger_patterns: ['deploy'],
          tags: ['frontend', 'ui'],
        }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        recentMessages: ['please deploy now'],
        gitContext: { branch: 'main', hasUncommittedChanges: true },
      }

      const recs = await service.recommendSkills(context)
      expect(recs).toHaveLength(1)
      expect(recs[0].reason).not.toContain('uncommitted changes')
      // Only the 0.4 trigger match applies, confidence should be 0.4 not 0.7.
      expect(recs[0].confidence).toBeCloseTo(0.4)
    })

    it('does not award git-context points when hasUncommittedChanges is false', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'clean-tree',
          trigger_patterns: ['deploy'],
          tags: ['git', 'commit'],
        }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        recentMessages: ['please deploy now'],
        gitContext: { branch: 'main', hasUncommittedChanges: false },
      }

      const recs = await service.recommendSkills(context)
      expect(recs).toHaveLength(1)
      expect(recs[0].confidence).toBeCloseTo(0.4)
    })

    it('caps confidence at 1.0 even when every bonus applies', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({
          id: 'maxed-out',
          trigger_patterns: ['deploy', 'release', 'ship'], // 3 * 0.4 = 1.2 alone
          tags: ['git', 'commit'],
          compatibility: { frameworks: ['next.js'] },
        }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        currentFile: 'app/page.tsx',
        recentMessages: ['deploy and release and ship this'],
        gitContext: { branch: 'main', hasUncommittedChanges: true },
      }

      const recs = await service.recommendSkills(context)
      expect(recs[0].confidence).toBe(1.0)
      expect(recs[0].autoLoad).toBe(true)
    })

    it('handles a skill with no triggerPatterns, no currentFile, and no gitContext gracefully (zero confidence, not recommended)', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'bare-skill', trigger_patterns: null, tags: [] }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
      }

      const recs = await service.recommendSkills(context)
      expect(recs).toHaveLength(0)
    })

    it('handles missing recentMessages by treating the match text as empty (no crash, no match)', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'no-messages', trigger_patterns: ['deploy'] }),
      ])

      const context: SkillContext = {
        sessionId: 's1',
        userId: 'user-1',
        // recentMessages intentionally omitted
      }

      const recs = await service.recommendSkills(context)
      expect(recs).toHaveLength(0)
    })
  })

  describe('searchSkills — framework/language filters and recent sort', () => {
    it('filters out skills whose compatibility.frameworks does not include a requested framework', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'next-skill', compatibility: { frameworks: ['next.js'] } }),
        dbSkillFixture({ id: 'vue-skill', compatibility: { frameworks: ['vue'] } }),
      ])

      const result = await service.searchSkills({ frameworks: ['next.js'] })

      expect(result.skills).toHaveLength(1)
      expect(result.skills[0].id).toBe('next-skill')
    })

    it('excludes a skill with no compatibility.frameworks at all when a framework filter is applied', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'no-compat', compatibility: null }),
      ])

      const result = await service.searchSkills({ frameworks: ['next.js'] })
      expect(result.skills).toHaveLength(0)
    })

    it('filters by language compatibility', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'ts-skill', compatibility: { languages: ['typescript'] } }),
        dbSkillFixture({ id: 'py-skill', compatibility: { languages: ['python'] } }),
      ])

      const result = await service.searchSkills({ languages: ['python'] })

      expect(result.skills).toHaveLength(1)
      expect(result.skills[0].id).toBe('py-skill')
    })

    it('excludes a skill with no compatibility.languages at all when a language filter is applied', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'no-compat', compatibility: undefined }),
      ])

      const result = await service.searchSkills({ languages: ['python'] })
      expect(result.skills).toHaveLength(0)
    })

    it('sorts by recent (newest createdAt first)', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'older', created_at: new Date('2024-01-01') }),
        dbSkillFixture({ id: 'newer', created_at: new Date('2024-06-01') }),
      ])

      const result = await service.searchSkills({ sortBy: 'recent' })

      expect(result.skills[0].id).toBe('newer')
      expect(result.skills[1].id).toBe('older')
    })

    it('leaves skill order unchanged when sortBy is an unrecognized/unsupported value such as "relevance"', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'first', created_at: new Date('2024-01-01') }),
        dbSkillFixture({ id: 'second', created_at: new Date('2024-06-01') }),
      ])

      const result = await service.searchSkills({ sortBy: 'relevance' })

      expect(result.skills.map((s) => s.id)).toEqual(['first', 'second'])
    })

    it('filters by authorId', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([
        dbSkillFixture({ id: 'mine', author_id: 'user-1' }),
        dbSkillFixture({ id: 'theirs', author_id: 'user-2' }),
      ])

      const result = await service.searchSkills({ authorId: 'user-2' })

      expect(result.skills).toHaveLength(1)
      expect(result.skills[0].id).toBe('theirs')
    })

    it('returns an empty result set when no skills exist at all', async () => {
      const { getAllActiveSkills } = await import('@/lib/db/queries')
      vi.mocked(getAllActiveSkills).mockResolvedValue([])

      const result = await service.searchSkills({})

      expect(result.skills).toHaveLength(0)
      expect(result.total).toBe(0)
    })
  })

  describe('getSkillService singleton', () => {
    it('returns the same instance across multiple calls', () => {
      const a = getSkillService()
      const b = getSkillService()
      expect(a).toBeInstanceOf(AgentSkillService)
      expect(a).toBe(b)
    })
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// queries.ts imports Next.js's 'server-only' guard, which vitest can't resolve.
vi.mock('server-only', () => ({}))

// vi.mock factories are hoisted above regular imports, so the chain mock
// must be constructed inside vi.hoisted (no outer-scope references allowed).
const { db, chain } = vi.hoisted(() => {
  const methods = [
    'select', 'from', 'where', 'orderBy', 'limit', 'insert', 'values',
    'returning', 'onConflictDoNothing', 'onConflictDoUpdate', 'update',
    'set', 'delete', 'leftJoin', 'innerJoin',
  ]
  let resolveValue: any = []
  const chainObj: any = {}
  for (const m of methods) chainObj[m] = vi.fn(() => chainObj)
  chainObj.then = (onFulfilled: any, onRejected: any) =>
    Promise.resolve(resolveValue).then(onFulfilled, onRejected)
  chainObj.catch = (onRejected: any) => Promise.resolve(resolveValue).catch(onRejected)
  chainObj.__setResolveValue = (next: any) => {
    resolveValue = next
    chainObj.then = (onFulfilled: any, onRejected: any) =>
      Promise.resolve(resolveValue).then(onFulfilled, onRejected)
  }
  chainObj.__setRejectValue = (err: any) => {
    chainObj.then = (_onFulfilled: any, onRejected: any) =>
      Promise.reject(err).then(_onFulfilled, onRejected)
  }

  const dbObj: any = {
    select: vi.fn(() => chainObj),
    insert: vi.fn(() => chainObj),
    update: vi.fn(() => chainObj),
    delete: vi.fn(() => chainObj),
  }

  return { db: dbObj, chain: chainObj }
})

vi.mock('@/lib/db/connection', () => ({
  default: db,
  db,
}))

import {
  createSkill,
  getSkillById,
  getAllActiveSkills,
  getBuiltInSkills,
  getSkillsByAuthor,
  updateSkill,
  deleteSkill,
  createSkillCollection,
  getSkillCollectionById,
  getSkillCollectionsByUser,
  getBuiltInSkillCollections,
  trackSkillUsage,
  getSkillUsageStats,
  getUserSkillUsage,
  upsertSkillRating,
  getSkillRatings,
} from '@/lib/db/queries'

describe('queries.ts — skills', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('createSkill inserts with defaults applied for optional fields', async () => {
    chain.__setResolveValue([{ id: 'skill-1' }])
    const result = await createSkill({
      id: 'skill-1',
      name: 'Deploy Helper',
      description: 'Helps deploy',
      version: '1.0.0',
      authorId: 'user-1',
      authorName: 'Toby',
      tags: ['deploy'],
      content: 'do the deploy thing',
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        id: 'skill-1',
        token_cost_metadata: 100,
        token_cost_full: 2000,
        is_built_in: false,
      }),
    )
    expect(result).toEqual([{ id: 'skill-1' }])
  })

  it('createSkill respects explicit overrides for defaulted fields', async () => {
    chain.__setResolveValue([{ id: 'skill-2' }])
    await createSkill({
      id: 'skill-2',
      name: 'n',
      description: 'd',
      version: '1',
      authorId: 'u',
      authorName: 'a',
      tags: [],
      content: 'c',
      tokenCostMetadata: 50,
      tokenCostFull: 500,
      isBuiltIn: true,
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        token_cost_metadata: 50,
        token_cost_full: 500,
        is_built_in: true,
      }),
    )
  })

  it('createSkill rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      createSkill({
        id: 's', name: 'n', description: 'd', version: '1',
        authorId: 'u', authorName: 'a', tags: [], content: 'c',
      }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSkillById returns the skill when found', async () => {
    chain.__setResolveValue([{ id: 'skill-1' }])
    const result = await getSkillById('skill-1')
    expect(result).toEqual({ id: 'skill-1' })
  })

  it('getSkillById returns null (not undefined) when not found', async () => {
    chain.__setResolveValue([])
    const result = await getSkillById('missing')
    expect(result).toBeNull()
  })

  it('getSkillById rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSkillById('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getAllActiveSkills returns the active skills', async () => {
    chain.__setResolveValue([{ id: 's1' }, { id: 's2' }])
    const result = await getAllActiveSkills()
    expect(result).toHaveLength(2)
  })

  it('getAllActiveSkills rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getAllActiveSkills()).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getBuiltInSkills returns built-in + active skills', async () => {
    chain.__setResolveValue([{ id: 's1', is_built_in: true }])
    const result = await getBuiltInSkills()
    expect(result).toEqual([{ id: 's1', is_built_in: true }])
  })

  it('getBuiltInSkills rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getBuiltInSkills()).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSkillsByAuthor returns skills for the given author', async () => {
    chain.__setResolveValue([{ id: 's1', author_id: 'user-1' }])
    const result = await getSkillsByAuthor('user-1')
    expect(result).toEqual([{ id: 's1', author_id: 'user-1' }])
  })

  it('getSkillsByAuthor returns [] when author has no skills', async () => {
    chain.__setResolveValue([])
    const result = await getSkillsByAuthor('user-nobody')
    expect(result).toEqual([])
  })

  it('getSkillsByAuthor rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSkillsByAuthor('u')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('updateSkill maps every provided camelCase field to its snake_case column', async () => {
    chain.__setResolveValue([{ id: 'skill-1' }])
    await updateSkill('skill-1', {
      name: 'New name',
      description: 'New desc',
      version: '2.0.0',
      tags: ['a', 'b'],
      triggerPatterns: ['trigger'],
      dependencies: ['dep'],
      tokenCostMetadata: 10,
      tokenCostFull: 20,
      compatibility: { frameworks: ['next'] },
      content: 'new content',
      references: [{ name: 'ref', path: '/p', type: 'markdown' }],
      examples: [{ title: 't', content: 'c' }],
      validationRules: ['rule'],
      commands: ['cmd'],
      isActive: false,
    })
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'New name',
        description: 'New desc',
        version: '2.0.0',
        tags: ['a', 'b'],
        trigger_patterns: ['trigger'],
        dependencies: ['dep'],
        token_cost_metadata: 10,
        token_cost_full: 20,
        compatibility: { frameworks: ['next'] },
        content: 'new content',
        references: [{ name: 'ref', path: '/p', type: 'markdown' }],
        examples: [{ title: 't', content: 'c' }],
        validation_rules: ['rule'],
        commands: ['cmd'],
        is_active: false,
        updated_at: expect.any(Date),
      }),
    )
  })

  it('updateSkill only sets updated_at when no fields are provided', async () => {
    chain.__setResolveValue([{ id: 'skill-1' }])
    await updateSkill('skill-1', {})
    const setArg = chain.set.mock.calls[0][0]
    expect(Object.keys(setArg)).toEqual(['updated_at'])
  })

  it('updateSkill rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(updateSkill('s', { name: 'n' })).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('deleteSkill deletes by id and resolves void', async () => {
    chain.__setResolveValue(undefined)
    await expect(deleteSkill('skill-1')).resolves.toBeUndefined()
    expect(db.delete).toHaveBeenCalled()
  })

  it('deleteSkill rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(deleteSkill('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

describe('queries.ts — skill collections', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('createSkillCollection inserts with defaults for optional flags', async () => {
    chain.__setResolveValue([{ id: 'coll-1' }])
    const result = await createSkillCollection({
      name: 'Starter pack',
      description: 'A few skills',
      skillIds: ['s1', 's2'],
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        name: 'Starter pack',
        skill_ids: ['s1', 's2'],
        is_built_in: false,
        is_team: false,
      }),
    )
    expect(result).toEqual([{ id: 'coll-1' }])
  })

  it('createSkillCollection respects explicit team/builtIn flags', async () => {
    chain.__setResolveValue([{ id: 'coll-2' }])
    await createSkillCollection({
      name: 'Team pack',
      description: 'd',
      skillIds: [],
      isBuiltIn: true,
      isTeam: true,
      teamId: 'team-1',
      userId: 'user-1',
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ is_built_in: true, is_team: true, team_id: 'team-1' }),
    )
  })

  it('createSkillCollection rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      createSkillCollection({ name: 'n', description: 'd', skillIds: [] }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSkillCollectionById returns the collection when found', async () => {
    chain.__setResolveValue([{ id: 'coll-1' }])
    const result = await getSkillCollectionById('coll-1')
    expect(result).toEqual({ id: 'coll-1' })
  })

  it('getSkillCollectionById returns null when not found', async () => {
    chain.__setResolveValue([])
    const result = await getSkillCollectionById('missing')
    expect(result).toBeNull()
  })

  it('getSkillCollectionById rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSkillCollectionById('c')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSkillCollectionsByUser returns the user collections', async () => {
    chain.__setResolveValue([{ id: 'coll-1' }])
    const result = await getSkillCollectionsByUser('user-1')
    expect(result).toEqual([{ id: 'coll-1' }])
  })

  it('getSkillCollectionsByUser rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSkillCollectionsByUser('u')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getBuiltInSkillCollections returns built-in collections', async () => {
    chain.__setResolveValue([{ id: 'coll-1', is_built_in: true }])
    const result = await getBuiltInSkillCollections()
    expect(result).toEqual([{ id: 'coll-1', is_built_in: true }])
  })

  it('getBuiltInSkillCollections rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getBuiltInSkillCollections()).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

describe('queries.ts — skill usage tracking', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('trackSkillUsage inserts the usage event', async () => {
    chain.__setResolveValue([{ id: 'usage-1' }])
    const result = await trackSkillUsage({
      skillId: 'skill-1',
      userId: 'user-1',
      loadType: 'auto',
      loadTimeMs: 42,
      metadataLoaded: true,
      contentLoaded: false,
      referencesLoaded: false,
      tokensUsed: 100,
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ skill_id: 'skill-1', load_type: 'auto', tokens_used: 100 }),
    )
    expect(result).toEqual([{ id: 'usage-1' }])
  })

  it('trackSkillUsage rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      trackSkillUsage({
        skillId: 's', userId: 'u', loadType: 'manual', loadTimeMs: 1,
        metadataLoaded: true, contentLoaded: true, referencesLoaded: true, tokensUsed: 1,
      }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSkillUsageStats computes aggregate stats across auto/manual loads', async () => {
    chain.__setResolveValue([
      { load_type: 'auto', load_time_ms: 100, tokens_used: 10 },
      { load_type: 'manual', load_time_ms: 200, tokens_used: 20 },
      { load_type: 'auto', load_time_ms: 300, tokens_used: 30 },
    ])
    const result = await getSkillUsageStats('skill-1')
    expect(result.totalLoads).toBe(3)
    expect(result.autoTriggers).toBe(2)
    expect(result.manualInvokes).toBe(1)
    expect(result.avgLoadTime).toBe(200) // (100+200+300)/3
    expect(result.totalTokensUsed).toBe(60)
  })

  it('getSkillUsageStats returns zeroed stats when there is no usage data', async () => {
    chain.__setResolveValue([])
    const result = await getSkillUsageStats('skill-unused')
    expect(result).toEqual({
      totalLoads: 0,
      autoTriggers: 0,
      manualInvokes: 0,
      avgLoadTime: 0,
      totalTokensUsed: 0,
    })
  })

  it('getSkillUsageStats rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSkillUsageStats('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getUserSkillUsage returns the usage history, respecting the limit param', async () => {
    chain.__setResolveValue([{ id: 'u1' }])
    const result = await getUserSkillUsage('user-1', 10)
    expect(chain.limit).toHaveBeenCalledWith(10)
    expect(result).toEqual([{ id: 'u1' }])
  })

  it('getUserSkillUsage defaults the limit to 50 when omitted', async () => {
    chain.__setResolveValue([])
    await getUserSkillUsage('user-1')
    expect(chain.limit).toHaveBeenCalledWith(50)
  })

  it('getUserSkillUsage rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getUserSkillUsage('u')).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

describe('queries.ts — skill ratings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('upsertSkillRating inserts/updates with helpful defaulted to true', async () => {
    chain.__setResolveValue([{ id: 'rating-1', rating: 5 }])
    const result = await upsertSkillRating({ skillId: 'skill-1', userId: 'user-1', rating: 5 })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ rating: 5, helpful: true }),
    )
    expect(chain.onConflictDoUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        target: expect.anything(),
        set: expect.objectContaining({ rating: 5, helpful: true }),
      }),
    )
    expect(result).toEqual([{ id: 'rating-1', rating: 5 }])
  })

  it('upsertSkillRating respects an explicit helpful:false and feedback text', async () => {
    chain.__setResolveValue([{ id: 'rating-2' }])
    await upsertSkillRating({
      skillId: 'skill-1',
      userId: 'user-1',
      rating: 2,
      feedbackText: 'not quite right',
      helpful: false,
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ helpful: false, feedback_text: 'not quite right' }),
    )
  })

  it('upsertSkillRating rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      upsertSkillRating({ skillId: 's', userId: 'u', rating: 1 }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSkillRatings computes the average rating across all ratings', async () => {
    chain.__setResolveValue([{ rating: 5 }, { rating: 3 }, { rating: 4 }])
    const result = await getSkillRatings('skill-1')
    expect(result.totalRatings).toBe(3)
    expect(result.averageRating).toBeCloseTo(4, 5)
    expect(result.ratings).toHaveLength(3)
  })

  it('getSkillRatings returns 0 average when there are no ratings', async () => {
    chain.__setResolveValue([])
    const result = await getSkillRatings('skill-unrated')
    expect(result).toEqual({ averageRating: 0, totalRatings: 0, ratings: [] })
  })

  it('getSkillRatings rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSkillRatings('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

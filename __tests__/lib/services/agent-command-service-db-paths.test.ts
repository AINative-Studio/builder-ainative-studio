import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Additional coverage for AgentCommandService beyond the pure-logic tests
 * in __tests__/services/agent-command.service.test.ts (substituteVariables
 * / validateVariables, already covered there and intentionally not
 * duplicated here). This file exercises the drizzle-backed CRUD paths,
 * the fuzzy search/scoring/sort pipeline, command execution orchestration
 * (pre-conditions, skill loading, logging, stats update), and their error
 * branches — the reason this file sits at ~6.94% coverage today.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
  delete: vi.fn(),
}))
vi.mock('@/lib/db', () => ({ db: dbMock }))
vi.mock('@/lib/db/schema', () => ({
  agent_commands: { is_active: 'is_active', category: 'category', author_id: 'author_id', is_built_in: 'is_built_in', is_team: 'is_team', id: 'id', usage_count: 'usage_count' },
  command_favorites: { command_id: 'command_id', user_id: 'user_id' },
  command_executions: { command_id: 'command_id', user_id: 'user_id', started_at: 'started_at', id: 'id' },
  command_templates: {},
}))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args) => ({ op: 'and', args })),
  or: vi.fn((...args) => ({ op: 'or', args })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
  asc: vi.fn((col) => ({ op: 'asc', col })),
  sql: Object.assign(vi.fn((...args) => ({ op: 'sql', args })), { raw: vi.fn() }),
  inArray: vi.fn((col, vals) => ({ op: 'inArray', col, vals })),
}))

const loadFullSkillMock = vi.hoisted(() => vi.fn())
vi.mock('@/lib/services/agent-skill.service', () => ({
  getSkillService: () => ({ loadFullSkill: loadFullSkillMock }),
}))

vi.mock('@/lib/validation/command-variables', () => ({
  substituteVariables: vi.fn((template: string) => template),
  validateVariables: vi.fn(() => ({ valid: true, errors: {} })),
}))

function selectLimitOffsetChain(rows: any[]) {
  return {
    from: () => ({
      where: () => ({
        limit: () => ({
          offset: () => Promise.resolve(rows),
        }),
      }),
    }),
  }
}

function selectWhereChain(rows: any[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) }
}

function selectWhereLimitChain(rows: any[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
}

function selectWhereOrderByLimitChain(rows: any[]) {
  return { from: () => ({ where: () => ({ orderBy: () => ({ limit: () => Promise.resolve(rows) }) }) }) }
}

function insertReturningChain(row: any) {
  return { values: () => ({ returning: () => Promise.resolve([row]) }) }
}

function insertNoReturningChain() {
  return { values: () => Promise.resolve(undefined) }
}

function updateReturningChain(row: any) {
  return { set: () => ({ where: () => ({ returning: () => Promise.resolve([row]) }) }) }
}

function updateNoReturningChain() {
  return { set: () => ({ where: () => Promise.resolve(undefined) }) }
}

function deleteChain() {
  return { where: () => Promise.resolve(undefined) }
}

const baseRecord = {
  id: 'cmd-1',
  name: 'Create PR',
  description: 'Creates a pull request',
  category: 'git',
  icon: null,
  tags: ['git', 'pr'],
  author_id: 'user-1',
  author_name: 'Alice',
  template: 'Create a PR titled {{prTitle}}',
  variables: [],
  required_skills: [],
  pre_conditions: [],
  checkpoints: [],
  output: {},
  validation_rules: [],
  estimated_token_cost: 100,
  is_built_in: false,
  is_team: false,
  team_id: null,
  usage_count: 5,
  avg_execution_time_ms: 1200,
  success_rate: 90,
  is_active: true,
  shortcut: null,
  created_at: new Date('2026-01-01'),
  updated_at: new Date('2026-01-02'),
}

describe('AgentCommandService — DB-backed paths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('searchCommands', () => {
    it('returns scored, name-matched results and marks fuzzyMatch true when a query is given', async () => {
      dbMock.select
        .mockReturnValueOnce(selectLimitOffsetChain([baseRecord]))
        .mockReturnValueOnce(selectWhereLimitChain([])) // favorite lookup in recordToCommand

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.searchCommands('user-1', { query: 'Create PR' })

      expect(result.fuzzyMatch).toBe(true)
      expect(result.commands).toHaveLength(1)
      expect(result.commands[0].metadata.name).toBe('Create PR')
    })

    it('filters out low-scoring results when the query does not match well', async () => {
      dbMock.select.mockReturnValueOnce(selectLimitOffsetChain([baseRecord]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.searchCommands('user-1', { query: 'zzz-no-match-at-all' })
      expect(result.commands).toHaveLength(0)
    })

    it('restricts to favorites when favoritesOnly is set, returning empty early when the user has none', async () => {
      dbMock.select
        .mockReturnValueOnce(selectLimitOffsetChain([baseRecord]))
        .mockReturnValueOnce(selectWhereChain([])) // user favorites lookup

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.searchCommands('user-1', { favoritesOnly: true })
      expect(result.commands).toEqual([])
      expect(result.total).toBe(0)
    })

    it('sorts by "popular" using usage_count descending', async () => {
      const low = { ...baseRecord, id: 'cmd-low', usage_count: 1 }
      const high = { ...baseRecord, id: 'cmd-high', usage_count: 99 }
      dbMock.select
        .mockReturnValueOnce(selectLimitOffsetChain([low, high]))
        .mockReturnValueOnce(selectWhereLimitChain([]))
        .mockReturnValueOnce(selectWhereLimitChain([]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.searchCommands('user-1', { sortBy: 'popular' })
      expect(result.commands[0].metadata.id).toBe('cmd-high')
    })

    it('sorts by "name" alphabetically', async () => {
      const b = { ...baseRecord, id: 'cmd-b', name: 'Bravo' }
      const a = { ...baseRecord, id: 'cmd-a', name: 'Alpha' }
      dbMock.select
        .mockReturnValueOnce(selectLimitOffsetChain([b, a]))
        .mockReturnValueOnce(selectWhereLimitChain([]))
        .mockReturnValueOnce(selectWhereLimitChain([]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.searchCommands('user-1', { sortBy: 'name' })
      expect(result.commands.map((c) => c.metadata.name)).toEqual(['Alpha', 'Bravo'])
    })

    it('returns an empty result (not a thrown error) when the underlying query throws', async () => {
      dbMock.select.mockImplementation(() => {
        throw new Error('db connection lost')
      })

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.searchCommands('user-1', {})
      expect(result).toEqual(
        expect.objectContaining({ commands: [], total: 0, fuzzyMatch: false })
      )
    })
  })

  describe('getCommand', () => {
    it('returns the command when found', async () => {
      dbMock.select
        .mockReturnValueOnce(selectWhereLimitChain([baseRecord]))
        .mockReturnValueOnce(selectWhereLimitChain([{ command_id: 'cmd-1', user_id: 'user-1' }]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.getCommand('cmd-1', 'user-1')
      expect(result?.metadata.id).toBe('cmd-1')
      expect(result?.metadata.isFavorite).toBe(true)
    })

    it('returns null when not found', async () => {
      dbMock.select.mockReturnValueOnce(selectWhereLimitChain([]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.getCommand('missing', 'user-1')).toBeNull()
    })

    it('returns null (not throw) when the query errors', async () => {
      dbMock.select.mockImplementation(() => {
        throw new Error('boom')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.getCommand('cmd-1', 'user-1')).toBeNull()
    })
  })

  describe('createCommand', () => {
    it('inserts and returns the created command', async () => {
      dbMock.insert.mockReturnValueOnce(insertReturningChain(baseRecord))
      dbMock.select.mockReturnValueOnce(selectWhereLimitChain([]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.createCommand(
        {
          metadata: {
            name: 'Create PR',
            description: 'desc',
            category: 'git' as any,
            tags: ['git'],
            author: { id: 'user-1', name: 'Alice' },
            isBuiltIn: false,
            isTeam: false,
            isActive: true,
          },
          template: 'Create a PR',
          variables: [],
          requiredSkills: [],
          preConditions: [],
          checkpoints: [],
          output: {} as any,
          version: '1.0.0',
        } as any,
        'user-1'
      )

      expect(result.metadata.id).toBe('cmd-1')
    })

    it('throws a generic error when insert fails', async () => {
      dbMock.insert.mockImplementation(() => {
        throw new Error('constraint violation')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      await expect(
        service.createCommand(
          {
            metadata: {
              name: 'x',
              description: 'x',
              category: 'git' as any,
              tags: [],
              author: { id: 'user-1', name: 'A' },
              isBuiltIn: false,
              isTeam: false,
              isActive: true,
            },
            template: 't',
            variables: [],
            requiredSkills: [],
            preConditions: [],
            checkpoints: [],
            output: {} as any,
            version: '1.0.0',
          } as any,
          'user-1'
        )
      ).rejects.toThrow('Failed to create command')
    })
  })

  describe('updateCommand', () => {
    it('updates only the provided fields and returns the updated command', async () => {
      dbMock.update.mockReturnValueOnce(updateReturningChain({ ...baseRecord, name: 'Renamed' }))
      dbMock.select.mockReturnValueOnce(selectWhereLimitChain([]))

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.updateCommand(
        'cmd-1',
        { metadata: { name: 'Renamed' } as any },
        'user-1'
      )
      expect(result.metadata.name).toBe('Renamed')
    })

    it('throws a generic error when update fails', async () => {
      dbMock.update.mockImplementation(() => {
        throw new Error('db error')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      await expect(service.updateCommand('cmd-1', {}, 'user-1')).rejects.toThrow(
        'Failed to update command'
      )
    })
  })

  describe('deleteCommand', () => {
    it('deletes the command', async () => {
      dbMock.delete.mockReturnValueOnce(deleteChain())
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      await expect(service.deleteCommand('cmd-1')).resolves.toBeUndefined()
    })

    it('throws a generic error when delete fails', async () => {
      dbMock.delete.mockImplementation(() => {
        throw new Error('fk constraint')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      await expect(service.deleteCommand('cmd-1')).rejects.toThrow('Failed to delete command')
    })
  })

  describe('toggleFavorite', () => {
    it('adds a favorite when none exists, returning true', async () => {
      dbMock.select.mockReturnValueOnce(selectWhereLimitChain([]))
      dbMock.insert.mockReturnValueOnce(insertNoReturningChain())

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.toggleFavorite('cmd-1', 'user-1')).toBe(true)
    })

    it('removes an existing favorite, returning false', async () => {
      dbMock.select.mockReturnValueOnce(selectWhereLimitChain([{ id: 'fav-1' }]))
      dbMock.delete.mockReturnValueOnce(deleteChain())

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.toggleFavorite('cmd-1', 'user-1')).toBe(false)
    })

    it('throws a generic error when the lookup fails', async () => {
      dbMock.select.mockImplementation(() => {
        throw new Error('db down')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      await expect(service.toggleFavorite('cmd-1', 'user-1')).rejects.toThrow(
        'Failed to toggle favorite'
      )
    })
  })

  describe('getExecutionHistory', () => {
    it('returns matching execution rows', async () => {
      dbMock.select.mockReturnValueOnce(selectWhereOrderByLimitChain([{ id: 'exec-1' }]))
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.getExecutionHistory('cmd-1', 'user-1')
      expect(result).toEqual([{ id: 'exec-1' }])
    })

    it('returns an empty array (not throw) on query failure', async () => {
      dbMock.select.mockImplementation(() => {
        throw new Error('db down')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.getExecutionHistory('cmd-1', 'user-1')).toEqual([])
    })
  })

  describe('getRecentCommands', () => {
    it('returns an empty array immediately when the user has no executions', async () => {
      dbMock.select.mockReturnValueOnce(selectWhereOrderByLimitChain([]))
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.getRecentCommands('user-1')).toEqual([])
    })

    it('resolves distinct recent command ids into full commands', async () => {
      dbMock.select
        .mockReturnValueOnce(
          selectWhereOrderByLimitChain([{ command_id: 'cmd-1' }, { command_id: 'cmd-1' }])
        )
        .mockReturnValueOnce(selectWhereChain([baseRecord]))
        .mockReturnValueOnce(selectWhereLimitChain([])) // favorite lookup

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const result = await service.getRecentCommands('user-1')
      expect(result).toHaveLength(1)
      expect(result[0].metadata.id).toBe('cmd-1')
    })

    it('returns an empty array (not throw) on query failure', async () => {
      dbMock.select.mockImplementation(() => {
        throw new Error('db down')
      })
      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      expect(await service.getRecentCommands('user-1')).toEqual([])
    })
  })

  describe('executeCommand', () => {
    const command = {
      metadata: { id: 'cmd-1' },
      template: 'Do the thing',
      checkpoints: [{ id: 'cp-1' }],
      requiredSkills: [],
      preConditions: [],
    } as any

    it('completes successfully when there are no pre-conditions or required skills', async () => {
      dbMock.insert.mockReturnValueOnce(insertNoReturningChain())
      dbMock.update
        .mockReturnValueOnce(updateNoReturningChain()) // saveExecutionState
        .mockReturnValueOnce(updateNoReturningChain()) // usage_count increment
        .mockReturnValueOnce(updateNoReturningChain()) // avg time / success rate

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const state = await service.executeCommand(command, {
        userId: 'user-1',
        chatId: 'chat-1',
        variableValues: {},
      } as any)

      expect(state.status).toBe('completed')
      expect(state.logs.some((l) => l.message.includes('completed'))).toBe(true)
    })

    it('fails when a blocking pre-condition is not satisfied', async () => {
      dbMock.insert.mockReturnValueOnce(insertNoReturningChain())
      dbMock.update.mockReturnValueOnce(updateNoReturningChain())

      const blockedCommand = {
        ...command,
        preConditions: [
          {
            id: 'pc-1',
            type: 'git_status',
            description: 'clean working tree',
            blocking: true,
            config: { gitStatus: 'clean' },
          },
        ],
      }

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const state = await service.executeCommand(blockedCommand, {
        userId: 'user-1',
        chatId: 'chat-1',
        variableValues: {},
        gitContext: { hasUncommittedChanges: true },
      } as any)

      expect(state.status).toBe('failed')
      expect(state.error?.message).toBe('Pre-conditions failed')
    })

    it('loads required skills, logging a warning when a skill fails to load', async () => {
      dbMock.insert.mockReturnValueOnce(insertNoReturningChain())
      dbMock.update
        .mockReturnValueOnce(updateNoReturningChain())
        .mockReturnValueOnce(updateNoReturningChain())
        .mockReturnValueOnce(updateNoReturningChain())
      loadFullSkillMock.mockRejectedValueOnce(new Error('skill not found'))

      const skillCommand = { ...command, requiredSkills: ['missing-skill'] }

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const state = await service.executeCommand(skillCommand, {
        userId: 'user-1',
        chatId: 'chat-1',
        variableValues: {},
      } as any)

      expect(state.status).toBe('completed')
      expect(state.logs.some((l) => l.level === 'warning' && l.message.includes('missing-skill'))).toBe(
        true
      )
    })

    it('marks the execution failed and records the error when an unexpected exception occurs', async () => {
      dbMock.insert.mockImplementation(() => {
        throw new Error('insert failed unexpectedly')
      })

      const { AgentCommandService } = await import('@/lib/services/agent-command.service')
      const service = new AgentCommandService()

      const state = await service.executeCommand(command, {
        userId: 'user-1',
        chatId: 'chat-1',
        variableValues: {},
      } as any)

      expect(state.status).toBe('failed')
      expect(state.error?.message).toBe('insert failed unexpectedly')
    })
  })
})

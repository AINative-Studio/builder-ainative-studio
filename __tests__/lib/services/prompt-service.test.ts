import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * Unit tests for prompt.service.ts: CRUD + A/B-test activation for
 * prompt_versions. Unlike most services in lib/services, this one imports
 * `db` as the DEFAULT export from '@/lib/db/connection' (not the named
 * export from '@/lib/db'), and every function guards on `db` being falsy
 * (POSTGRES_URL unset) by throwing 'Database not available'.
 */

const dbMock = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  update: vi.fn(),
}))
vi.mock('@/lib/db/connection', () => ({ default: dbMock }))
vi.mock('@/lib/db/schema', () => ({ prompt_versions: {} }))
vi.mock('drizzle-orm', () => ({
  eq: vi.fn((a, b) => ({ op: 'eq', a, b })),
  and: vi.fn((...args) => ({ op: 'and', args })),
  desc: vi.fn((col) => ({ op: 'desc', col })),
}))

function selectOrderByChain(rows: any[]) {
  return { from: () => ({ orderBy: () => Promise.resolve(rows) }) }
}
function selectWhereLimitChain(rows: any[]) {
  return { from: () => ({ where: () => ({ limit: () => Promise.resolve(rows) }) }) }
}
function selectWhereChain(rows: any[]) {
  return { from: () => ({ where: () => Promise.resolve(rows) }) }
}
function insertReturningChain(row: any) {
  return { values: () => ({ returning: () => Promise.resolve([row]) }) }
}
function updateReturningChain(row: any) {
  return { set: () => ({ where: () => ({ returning: () => Promise.resolve([row]) }) }) }
}

describe('prompt.service — database-not-available guard', () => {
  it('every exported function throws when db is null', async () => {
    vi.doMock('@/lib/db/connection', () => ({ default: null }))
    const prompts = await import('@/lib/services/prompt.service')

    await expect(prompts.getAllPrompts()).rejects.toThrow('Database not available')
    await expect(prompts.getPromptById('x')).rejects.toThrow('Database not available')
    await expect(prompts.createPrompt({ type: 't', version: 'v', content: 'c' })).rejects.toThrow(
      'Database not available'
    )
    await expect(prompts.updatePrompt('x', {})).rejects.toThrow('Database not available')
    await expect(prompts.activatePrompt('x')).rejects.toThrow('Database not available')
    await expect(prompts.getActivePrompts('t')).rejects.toThrow('Database not available')
    await expect(prompts.deactivatePrompt('x')).rejects.toThrow('Database not available')

    vi.doUnmock('@/lib/db/connection')
  })
})

describe('prompt.service — with a database available', () => {
  beforeEach(() => {
    vi.resetModules()
    vi.clearAllMocks()
    vi.doMock('@/lib/db/connection', () => ({ default: dbMock }))
  })

  it('getAllPrompts returns all rows ordered by created_at desc', async () => {
    dbMock.select.mockReturnValue(selectOrderByChain([{ id: 'p1' }, { id: 'p2' }]))
    const { getAllPrompts } = await import('@/lib/services/prompt.service')

    const result = await getAllPrompts()
    expect(result).toEqual([{ id: 'p1' }, { id: 'p2' }])
  })

  it('getPromptById returns the matching row', async () => {
    dbMock.select.mockReturnValue(selectWhereLimitChain([{ id: 'p1', type: 'system' }]))
    const { getPromptById } = await import('@/lib/services/prompt.service')

    const result = await getPromptById('p1')
    expect(result).toEqual({ id: 'p1', type: 'system' })
  })

  it('getPromptById throws when nothing matches', async () => {
    dbMock.select.mockReturnValue(selectWhereLimitChain([]))
    const { getPromptById } = await import('@/lib/services/prompt.service')

    await expect(getPromptById('missing')).rejects.toThrow('Prompt not found')
  })

  it('createPrompt inserts with defaults (is_active false, ab_test_percentage 0) when omitted', async () => {
    const insertSpy = vi.fn().mockReturnValue(insertReturningChain({ id: 'new-1' }))
    dbMock.insert.mockImplementation(insertSpy)
    const { createPrompt } = await import('@/lib/services/prompt.service')

    const result = await createPrompt({ type: 'system', version: '1.0', content: 'hello' })

    expect(result).toEqual({ id: 'new-1' })
    expect(dbMock.insert).toHaveBeenCalled()
  })

  it('updatePrompt only sets fields explicitly provided in the update payload', async () => {
    dbMock.select.mockReturnValue(selectWhereLimitChain([{ id: 'p1', type: 'system' }]))
    dbMock.update.mockReturnValue(updateReturningChain({ id: 'p1', content: 'updated' }))
    const { updatePrompt } = await import('@/lib/services/prompt.service')

    const result = await updatePrompt('p1', { content: 'updated' })
    expect(result).toEqual({ id: 'p1', content: 'updated' })
  })

  it('updatePrompt rejects when the prompt does not exist (via getPromptById)', async () => {
    dbMock.select.mockReturnValue(selectWhereLimitChain([]))
    const { updatePrompt } = await import('@/lib/services/prompt.service')

    await expect(updatePrompt('missing', { content: 'x' })).rejects.toThrow('Prompt not found')
  })

  it('activatePrompt deactivates siblings of the same type then activates the target', async () => {
    dbMock.select.mockReturnValue(selectWhereLimitChain([{ id: 'p1', type: 'system' }]))
    const updateCalls: any[] = []
    dbMock.update.mockImplementation((...args: any[]) => {
      updateCalls.push(args)
      return updateReturningChain({ id: 'p1', is_active: true })
    })
    const { activatePrompt } = await import('@/lib/services/prompt.service')

    const result = await activatePrompt('p1')
    expect(result).toEqual({ id: 'p1', is_active: true })
    // Deactivate-siblings + activate-target = 2 separate update() calls.
    expect(dbMock.update).toHaveBeenCalledTimes(2)
  })

  it('getActivePrompts filters by type and is_active', async () => {
    dbMock.select.mockReturnValue(selectWhereChain([{ id: 'p1', is_active: true }]))
    const { getActivePrompts } = await import('@/lib/services/prompt.service')

    const result = await getActivePrompts('system')
    expect(result).toEqual([{ id: 'p1', is_active: true }])
  })

  it('deactivatePrompt sets is_active to false and returns the updated row', async () => {
    dbMock.update.mockReturnValue(updateReturningChain({ id: 'p1', is_active: false }))
    const { deactivatePrompt } = await import('@/lib/services/prompt.service')

    const result = await deactivatePrompt('p1')
    expect(result).toEqual({ id: 'p1', is_active: false })
  })
})

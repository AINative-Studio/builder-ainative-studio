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
  getUser,
  createUser,
  createChatOwnership,
  getChatOwnership,
  getChatIdsByUserId,
  deleteChatOwnership,
  getChatCountByUserId,
  getChatCountByIP,
  createAnonymousChatLog,
  createSession,
  getSession,
  updateSessionActivity,
  deleteSession,
  deleteUserSessions,
  cleanupExpiredSessions,
} from '@/lib/db/queries'

describe('queries.ts — users', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  describe('getUser', () => {
    it('returns the rows resolved by the select chain', async () => {
      chain.__setResolveValue([{ id: '1', email: 'a@b.com' }])
      const result = await getUser('a@b.com')
      expect(db.select).toHaveBeenCalled()
      expect(result).toEqual([{ id: '1', email: 'a@b.com' }])
    })

    it('returns an empty array when no user matches', async () => {
      chain.__setResolveValue([])
      const result = await getUser('missing@b.com')
      expect(result).toEqual([])
    })

    it('rethrows and logs when the query fails', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      chain.__setRejectValue(new Error('connection refused'))
      await expect(getUser('a@b.com')).rejects.toThrow('connection refused')
      expect(spy).toHaveBeenCalledWith('Failed to get user from database')
      spy.mockRestore()
    })
  })

  describe('createUser', () => {
    it('hashes the password and inserts with the default workspace', async () => {
      chain.__setResolveValue([{ id: '1', email: 'new@b.com' }])
      const result = await createUser('new@b.com', 'plaintext-pw')
      expect(db.insert).toHaveBeenCalled()
      expect(chain.values).toHaveBeenCalled()
      const insertedValues = chain.values.mock.calls[0][0]
      expect(insertedValues.email).toBe('new@b.com')
      expect(insertedValues.password).not.toBe('plaintext-pw')
      expect(insertedValues.workspace_id).toBeTruthy()
      expect(insertedValues.is_active).toBe(true)
      expect(result).toEqual([{ id: '1', email: 'new@b.com' }])
    })

    it('rethrows and logs when insert fails', async () => {
      const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
      chain.__setRejectValue(new Error('unique violation'))
      await expect(createUser('dup@b.com', 'pw')).rejects.toThrow('unique violation')
      expect(spy).toHaveBeenCalledWith('Failed to create user in database')
      spy.mockRestore()
    })
  })
})

describe('queries.ts — chat ownership', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('createChatOwnership inserts with onConflictDoNothing', async () => {
    chain.__setResolveValue(undefined)
    await createChatOwnership({ chatId: 'chat-1', userId: 'user-1' })
    expect(db.insert).toHaveBeenCalled()
    expect(chain.values).toHaveBeenCalledWith({ chat_id: 'chat-1', user_id: 'user-1' })
    expect(chain.onConflictDoNothing).toHaveBeenCalled()
  })

  it('createChatOwnership rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('db down'))
    await expect(createChatOwnership({ chatId: 'c', userId: 'u' })).rejects.toThrow('db down')
    spy.mockRestore()
  })

  it('getChatOwnership returns the single ownership row (destructured)', async () => {
    chain.__setResolveValue([{ chat_id: 'chat-1', user_id: 'user-1' }])
    const result = await getChatOwnership({ chatId: 'chat-1' })
    expect(result).toEqual({ chat_id: 'chat-1', user_id: 'user-1' })
  })

  it('getChatOwnership returns undefined when nothing matches', async () => {
    chain.__setResolveValue([])
    const result = await getChatOwnership({ chatId: 'missing' })
    expect(result).toBeUndefined()
  })

  it('getChatOwnership rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('timeout'))
    await expect(getChatOwnership({ chatId: 'x' })).rejects.toThrow('timeout')
    spy.mockRestore()
  })

  it('getChatIdsByUserId maps rows to a plain string array', async () => {
    chain.__setResolveValue([{ chatId: 'c1' }, { chatId: 'c2' }])
    const result = await getChatIdsByUserId({ userId: 'user-1' })
    expect(result).toEqual(['c1', 'c2'])
  })

  it('getChatIdsByUserId returns [] when the user owns no chats', async () => {
    chain.__setResolveValue([])
    const result = await getChatIdsByUserId({ userId: 'user-1' })
    expect(result).toEqual([])
  })

  it('getChatIdsByUserId rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getChatIdsByUserId({ userId: 'u' })).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('deleteChatOwnership issues a delete filtered by chatId', async () => {
    chain.__setResolveValue(undefined)
    await deleteChatOwnership({ chatId: 'chat-1' })
    expect(db.delete).toHaveBeenCalled()
    expect(chain.where).toHaveBeenCalled()
  })

  it('deleteChatOwnership rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(deleteChatOwnership({ chatId: 'c' })).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

describe('queries.ts — rate limiting', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('getChatCountByUserId returns the count from the aggregate row', async () => {
    chain.__setResolveValue([{ count: 7 }])
    const result = await getChatCountByUserId({ userId: 'user-1', differenceInHours: 24 })
    expect(result).toBe(7)
  })

  it('getChatCountByUserId falls back to 0 when no stats row is returned', async () => {
    chain.__setResolveValue([])
    const result = await getChatCountByUserId({ userId: 'user-1', differenceInHours: 24 })
    expect(result).toBe(0)
  })

  it('getChatCountByUserId falls back to 0 when count is falsy (0)', async () => {
    chain.__setResolveValue([{ count: 0 }])
    const result = await getChatCountByUserId({ userId: 'user-1', differenceInHours: 24 })
    expect(result).toBe(0)
  })

  it('getChatCountByUserId rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      getChatCountByUserId({ userId: 'u', differenceInHours: 1 }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getChatCountByIP returns the count from the aggregate row', async () => {
    chain.__setResolveValue([{ count: 3 }])
    const result = await getChatCountByIP({ ipAddress: '1.2.3.4', differenceInHours: 1 })
    expect(result).toBe(3)
  })

  it('getChatCountByIP falls back to 0 when no stats row is returned', async () => {
    chain.__setResolveValue([])
    const result = await getChatCountByIP({ ipAddress: '1.2.3.4', differenceInHours: 1 })
    expect(result).toBe(0)
  })

  it('getChatCountByIP rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      getChatCountByIP({ ipAddress: '1.2.3.4', differenceInHours: 1 }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('createAnonymousChatLog inserts the ip/chatId pair', async () => {
    chain.__setResolveValue(undefined)
    await createAnonymousChatLog({ ipAddress: '1.2.3.4', chatId: 'chat-1' })
    expect(db.insert).toHaveBeenCalled()
    expect(chain.values).toHaveBeenCalledWith({ ip_address: '1.2.3.4', chat_id: 'chat-1' })
  })

  it('createAnonymousChatLog rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      createAnonymousChatLog({ ipAddress: '1.2.3.4', chatId: 'c' }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

describe('queries.ts — session management', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('createSession inserts with the given id/userId/expiresAt', async () => {
    const expiresAt = new Date('2026-01-01')
    chain.__setResolveValue([{ id: 'sess-1', user_id: 'user-1', expires_at: expiresAt }])
    const result = await createSession({ sessionId: 'sess-1', userId: 'user-1', expiresAt })
    expect(chain.values).toHaveBeenCalledWith({
      id: 'sess-1',
      user_id: 'user-1',
      expires_at: expiresAt,
    })
    expect(result).toEqual([{ id: 'sess-1', user_id: 'user-1', expires_at: expiresAt }])
  })

  it('createSession rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      createSession({ sessionId: 's', userId: 'u', expiresAt: new Date() }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getSession returns the single matching session', async () => {
    chain.__setResolveValue([{ id: 'sess-1' }])
    const result = await getSession('sess-1')
    expect(result).toEqual({ id: 'sess-1' })
  })

  it('getSession returns undefined when not found', async () => {
    chain.__setResolveValue([])
    const result = await getSession('missing')
    expect(result).toBeUndefined()
  })

  it('getSession rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getSession('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('updateSessionActivity updates last_activity and resolves void', async () => {
    chain.__setResolveValue(undefined)
    await expect(updateSessionActivity('sess-1')).resolves.toBeUndefined()
    expect(db.update).toHaveBeenCalled()
    expect(chain.set).toHaveBeenCalled()
  })

  it('updateSessionActivity rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(updateSessionActivity('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('deleteSession deletes by id', async () => {
    chain.__setResolveValue(undefined)
    await expect(deleteSession('sess-1')).resolves.toBeUndefined()
    expect(db.delete).toHaveBeenCalled()
  })

  it('deleteSession rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(deleteSession('s')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('deleteUserSessions deletes all sessions for a user', async () => {
    chain.__setResolveValue(undefined)
    await expect(deleteUserSessions('user-1')).resolves.toBeUndefined()
    expect(db.delete).toHaveBeenCalled()
  })

  it('deleteUserSessions rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(deleteUserSessions('u')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('cleanupExpiredSessions returns the delete rowCount', async () => {
    chain.__setResolveValue({ rowCount: 5 })
    const result = await cleanupExpiredSessions()
    expect(result).toBe(5)
  })

  it('cleanupExpiredSessions returns 0 when rowCount is absent', async () => {
    chain.__setResolveValue({})
    const result = await cleanupExpiredSessions()
    expect(result).toBe(0)
  })

  it('cleanupExpiredSessions swallows errors and returns 0 (does not throw)', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    const result = await cleanupExpiredSessions()
    expect(result).toBe(0)
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

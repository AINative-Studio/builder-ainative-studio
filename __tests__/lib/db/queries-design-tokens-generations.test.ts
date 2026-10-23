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
  createDesignToken,
  getDesignToken,
  getDesignTokensByUserId,
  getDesignTokenVersions,
  getActiveDesignToken,
  setActiveDesignToken,
  updateDesignToken,
  deleteDesignToken,
  createGeneration,
  getGenerationsByDesignToken,
} from '@/lib/db/queries'

describe('queries.ts — design tokens', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('createDesignToken inserts without deactivating others when isActive is false/default', async () => {
    chain.__setResolveValue([{ id: 'tok-1', is_active: false }])
    const result = await createDesignToken({
      userId: 'user-1',
      name: 'brand',
      tokens: { color: 'red' },
      version: '1.0.0',
    })
    // update() is only called when isActive=true; default is false, so no update.
    expect(db.update).not.toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({ user_id: 'user-1', name: 'brand', is_active: false }),
    )
    expect(result).toEqual([{ id: 'tok-1', is_active: false }])
  })

  it('createDesignToken deactivates other tokens first when isActive is true', async () => {
    chain.__setResolveValue([{ id: 'tok-2', is_active: true }])
    await createDesignToken({
      userId: 'user-1',
      name: 'brand',
      tokens: {},
      version: '2.0.0',
      isActive: true,
    })
    expect(db.update).toHaveBeenCalled()
    expect(db.insert).toHaveBeenCalled()
  })

  it('createDesignToken rethrows and logs on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      createDesignToken({ userId: 'u', name: 'n', tokens: {}, version: '1' }),
    ).rejects.toThrow('fail')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })

  it('getDesignToken returns the single matching token', async () => {
    chain.__setResolveValue([{ id: 'tok-1' }])
    const result = await getDesignToken('tok-1')
    expect(result).toEqual({ id: 'tok-1' })
  })

  it('getDesignToken returns undefined when not found', async () => {
    chain.__setResolveValue([])
    const result = await getDesignToken('missing')
    expect(result).toBeUndefined()
  })

  it('getDesignToken rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getDesignToken('t')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getDesignTokensByUserId returns all tokens for a user', async () => {
    chain.__setResolveValue([{ id: 't1' }, { id: 't2' }])
    const result = await getDesignTokensByUserId('user-1')
    expect(result).toEqual([{ id: 't1' }, { id: 't2' }])
  })

  it('getDesignTokensByUserId rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getDesignTokensByUserId('u')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getDesignTokenVersions returns all versions for the named token', async () => {
    chain.__setResolveValue([{ id: 't1', version: '2' }, { id: 't2', version: '1' }])
    const result = await getDesignTokenVersions({ userId: 'user-1', name: 'brand' })
    expect(result).toHaveLength(2)
  })

  it('getDesignTokenVersions rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      getDesignTokenVersions({ userId: 'u', name: 'n' }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getActiveDesignToken returns the one active token', async () => {
    chain.__setResolveValue([{ id: 't1', is_active: true }])
    const result = await getActiveDesignToken('user-1')
    expect(result).toEqual({ id: 't1', is_active: true })
  })

  it('getActiveDesignToken returns undefined when no token is active', async () => {
    chain.__setResolveValue([])
    const result = await getActiveDesignToken('user-1')
    expect(result).toBeUndefined()
  })

  it('getActiveDesignToken rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getActiveDesignToken('u')).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('setActiveDesignToken deactivates all then activates the target', async () => {
    chain.__setResolveValue([{ id: 'tok-1', is_active: true }])
    const result = await setActiveDesignToken({ userId: 'user-1', tokenId: 'tok-1' })
    expect(db.update).toHaveBeenCalledTimes(2)
    expect(result).toEqual([{ id: 'tok-1', is_active: true }])
  })

  it('setActiveDesignToken rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      setActiveDesignToken({ userId: 'u', tokenId: 't' }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('updateDesignToken updates tokens and bumps updated_at', async () => {
    chain.__setResolveValue([{ id: 'tok-1', tokens: { a: 1 } }])
    const result = await updateDesignToken({
      tokenId: 'tok-1',
      userId: 'user-1',
      tokens: { a: 1 },
    })
    expect(chain.set).toHaveBeenCalledWith(
      expect.objectContaining({ tokens: { a: 1 }, updated_at: expect.any(Date) }),
    )
    expect(result).toEqual([{ id: 'tok-1', tokens: { a: 1 } }])
  })

  it('updateDesignToken rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      updateDesignToken({ tokenId: 't', userId: 'u', tokens: {} }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('deleteDesignToken deletes by tokenId+userId and resolves void', async () => {
    chain.__setResolveValue(undefined)
    await expect(
      deleteDesignToken({ tokenId: 'tok-1', userId: 'user-1' }),
    ).resolves.toBeUndefined()
    expect(db.delete).toHaveBeenCalled()
  })

  it('deleteDesignToken rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      deleteDesignToken({ tokenId: 't', userId: 'u' }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

describe('queries.ts — generations', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    chain.__setResolveValue([])
  })

  it('createGeneration inserts all fields including optional ones', async () => {
    chain.__setResolveValue([{ id: 'gen-1' }])
    const result = await createGeneration({
      chatId: 'chat-1',
      userId: 'user-1',
      prompt: 'build me a landing page',
      generatedCode: '<div/>',
      promptVersionId: 'pv-1',
      designTokensVersionId: 'dt-1',
      model: 'claude-sonnet',
      templateUsed: 'landing',
      generationTimeMs: 1200,
    })
    expect(chain.values).toHaveBeenCalledWith({
      chat_id: 'chat-1',
      user_id: 'user-1',
      prompt: 'build me a landing page',
      generated_code: '<div/>',
      prompt_version_id: 'pv-1',
      design_tokens_version_id: 'dt-1',
      model: 'claude-sonnet',
      template_used: 'landing',
      generation_time_ms: 1200,
    })
    expect(result).toEqual([{ id: 'gen-1' }])
  })

  it('createGeneration works without the optional fields', async () => {
    chain.__setResolveValue([{ id: 'gen-2' }])
    await createGeneration({
      chatId: 'chat-2',
      userId: 'user-2',
      prompt: 'p',
      generatedCode: 'c',
      model: 'm',
      generationTimeMs: 1,
    })
    expect(chain.values).toHaveBeenCalledWith(
      expect.objectContaining({
        prompt_version_id: undefined,
        design_tokens_version_id: undefined,
        template_used: undefined,
      }),
    )
  })

  it('createGeneration rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(
      createGeneration({
        chatId: 'c', userId: 'u', prompt: 'p', generatedCode: 'g',
        model: 'm', generationTimeMs: 1,
      }),
    ).rejects.toThrow('fail')
    spy.mockRestore()
  })

  it('getGenerationsByDesignToken returns matching generations', async () => {
    chain.__setResolveValue([{ id: 'gen-1' }, { id: 'gen-2' }])
    const result = await getGenerationsByDesignToken('dt-1')
    expect(result).toHaveLength(2)
  })

  it('getGenerationsByDesignToken returns [] when none match', async () => {
    chain.__setResolveValue([])
    const result = await getGenerationsByDesignToken('dt-missing')
    expect(result).toEqual([])
  })

  it('getGenerationsByDesignToken rethrows on failure', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    chain.__setRejectValue(new Error('fail'))
    await expect(getGenerationsByDesignToken('dt')).rejects.toThrow('fail')
    spy.mockRestore()
  })
})

import { describe, it, expect, vi, beforeEach } from 'vitest'

// preview-store-redis.ts imports { getRedisClient } from './redis', which
// resolves (via the @ alias) to @/lib/redis. Mock it so we control what
// getRedisClient() returns per test instead of hitting the real disabled
// (always-null) implementation.
const { getRedisClient } = vi.hoisted(() => ({ getRedisClient: vi.fn() }))
vi.mock('@/lib/redis', () => ({ getRedisClient }))

import {
  storePreview,
  getPreview,
  getChatData,
  hasPreview,
  listPreviews,
  getAllChats,
  updatePreviewPartial,
  deletePreview,
  cleanupExpiredChats,
} from '@/lib/preview-store-redis'

function makeFakeRedis() {
  return {
    setex: vi.fn().mockResolvedValue('OK'),
    get: vi.fn().mockResolvedValue(null),
    exists: vi.fn().mockResolvedValue(0),
    keys: vi.fn().mockResolvedValue([]),
    zadd: vi.fn().mockResolvedValue(1),
    zrevrange: vi.fn().mockResolvedValue([]),
    zrange: vi.fn().mockResolvedValue([]),
    zrem: vi.fn().mockResolvedValue(1),
    del: vi.fn().mockResolvedValue(1),
  }
}

let fakeRedis: ReturnType<typeof makeFakeRedis>

beforeEach(() => {
  vi.clearAllMocks()
  fakeRedis = makeFakeRedis()
  getRedisClient.mockReturnValue(fakeRedis)
})

describe('lib/preview-store-redis', () => {
  describe('against the REAL (disabled) lib/redis module', () => {
    it('throws because getRedisClient() returns null with no null-check', async () => {
      // Temporarily restore the real module behavior for this one test by
      // having the mock return null, mirroring the real lib/redis.ts.
      getRedisClient.mockReturnValue(null)
      await expect(storePreview('abc', 'content')).rejects.toBeInstanceOf(TypeError)
    })
  })

  describe('storePreview', () => {
    it('creates a brand-new chat with a name derived from userMessage when provided', async () => {
      fakeRedis.get.mockResolvedValueOnce(null) // no existing chat

      await storePreview('id1', '<div>hi</div>', 'Build me a todo app please')

      expect(fakeRedis.setex).toHaveBeenNthCalledWith(1, 'preview:id1', expect.any(Number), '<div>hi</div>')

      const chatJsonCall = fakeRedis.setex.mock.calls[1]
      expect(chatJsonCall[0]).toBe('chat:id1')
      const stored = JSON.parse(chatJsonCall[2])
      expect(stored.name).toBe('Build me a todo app please'.slice(0, 50))
      expect(stored.messages).toHaveLength(2)
      expect(stored.messages[0].role).toBe('user')
      expect(stored.messages[0].content).toBe('Build me a todo app please')
      expect(stored.messages[1].role).toBe('assistant')
      expect(stored.messages[1].content).toBe('<div>hi</div>')

      expect(fakeRedis.zadd).toHaveBeenCalledWith('chat:list', expect.any(Number), 'id1')
    })

    it('falls back to a generated name when no userMessage is given', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)

      await storePreview('abcdefgh12', '<div>hi</div>')

      const chatJsonCall = fakeRedis.setex.mock.calls[1]
      const stored = JSON.parse(chatJsonCall[2])
      expect(stored.name).toBe(`Chat ${'abcdefgh12'.slice(0, 8)}`)
      expect(stored.messages).toHaveLength(1)
      expect(stored.messages[0].role).toBe('assistant')
    })

    it('appends to existing messages and preserves createdAt/name on a second store', async () => {
      const existingChat = {
        preview: 'old content',
        messages: [{ id: 'old-1', role: 'assistant', content: 'old content' }],
        createdAt: '2020-01-01T00:00:00.000Z',
        name: 'Original Name',
      }
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(existingChat))

      await storePreview('id2', 'new content', 'another message')

      const chatJsonCall = fakeRedis.setex.mock.calls[1]
      const stored = JSON.parse(chatJsonCall[2])

      expect(stored.createdAt).toBe('2020-01-01T00:00:00.000Z')
      expect(stored.name).toBe('Original Name')
      expect(stored.messages).toHaveLength(3)
      expect(stored.messages[0]).toEqual(existingChat.messages[0])
      expect(stored.messages[1].role).toBe('user')
      expect(stored.messages[2].role).toBe('assistant')
    })

    it('propagates the error when redis.setex rejects', async () => {
      fakeRedis.setex.mockRejectedValueOnce(new Error('redis down'))
      await expect(storePreview('id3', 'content')).rejects.toThrow('redis down')
    })
  })

  describe('getPreview', () => {
    it('returns the content string on a hit', async () => {
      fakeRedis.get.mockResolvedValueOnce('<div>hello</div>')
      await expect(getPreview('id1')).resolves.toBe('<div>hello</div>')
    })

    it('returns undefined on a miss (null from redis)', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      await expect(getPreview('id1')).resolves.toBeUndefined()
    })

    it('swallows errors and resolves to undefined', async () => {
      fakeRedis.get.mockRejectedValueOnce(new Error('boom'))
      await expect(getPreview('id1')).resolves.toBeUndefined()
    })
  })

  describe('getChatData', () => {
    it('parses and returns JSON on a hit', async () => {
      const chat = { preview: 'x', messages: [], createdAt: '2020-01-01T00:00:00.000Z' }
      fakeRedis.get.mockResolvedValueOnce(JSON.stringify(chat))
      await expect(getChatData('id1')).resolves.toEqual(chat)
    })

    it('returns undefined on a miss', async () => {
      fakeRedis.get.mockResolvedValueOnce(null)
      await expect(getChatData('id1')).resolves.toBeUndefined()
    })

    it('swallows thrown errors and returns undefined', async () => {
      fakeRedis.get.mockRejectedValueOnce(new Error('boom'))
      await expect(getChatData('id1')).resolves.toBeUndefined()
    })
  })

  describe('hasPreview', () => {
    it('returns true only when exists() resolves to exactly 1', async () => {
      fakeRedis.exists.mockResolvedValueOnce(1)
      await expect(hasPreview('id1')).resolves.toBe(true)
    })

    it('returns false when exists() resolves to 0', async () => {
      fakeRedis.exists.mockResolvedValueOnce(0)
      await expect(hasPreview('id1')).resolves.toBe(false)
    })

    it('returns false (strict equality) when exists() resolves to a truthy non-1 number', async () => {
      fakeRedis.exists.mockResolvedValueOnce(2)
      await expect(hasPreview('id1')).resolves.toBe(false)
    })

    it('swallows errors and returns false', async () => {
      fakeRedis.exists.mockRejectedValueOnce(new Error('boom'))
      await expect(hasPreview('id1')).resolves.toBe(false)
    })
  })

  describe('listPreviews', () => {
    it('strips the preview: prefix from each key', async () => {
      fakeRedis.keys.mockResolvedValueOnce(['preview:a', 'preview:b'])
      await expect(listPreviews()).resolves.toEqual(['a', 'b'])
    })

    it('returns an empty array when there are no keys', async () => {
      fakeRedis.keys.mockResolvedValueOnce([])
      await expect(listPreviews()).resolves.toEqual([])
    })

    it('swallows errors and returns an empty array', async () => {
      fakeRedis.keys.mockRejectedValueOnce(new Error('boom'))
      await expect(listPreviews()).resolves.toEqual([])
    })
  })

  describe('getAllChats', () => {
    it('returns chats newest-first, excluding ids whose chat data is missing', async () => {
      fakeRedis.zrevrange.mockResolvedValueOnce(['id1', 'id2'])

      const chat1 = { preview: 'p1', messages: [], createdAt: '2020-01-01T00:00:00.000Z', name: 'Chat One' }
      // id1 -> getChatData hits; id2 -> getChatData misses (null)
      fakeRedis.get.mockImplementation((key: string) => {
        if (key === 'chat:id1') return Promise.resolve(JSON.stringify(chat1))
        if (key === 'chat:id2') return Promise.resolve(null)
        return Promise.resolve(null)
      })

      const result = await getAllChats()

      expect(result).toEqual([{ id: 'id1', name: 'Chat One', createdAt: '2020-01-01T00:00:00.000Z' }])
      expect(fakeRedis.zrevrange).toHaveBeenCalledWith('chat:list', 0, -1)
    })

    it('returns an empty array when there are no chat ids', async () => {
      fakeRedis.zrevrange.mockResolvedValueOnce([])
      await expect(getAllChats()).resolves.toEqual([])
    })

    it('swallows errors and returns an empty array', async () => {
      fakeRedis.zrevrange.mockRejectedValueOnce(new Error('boom'))
      await expect(getAllChats()).resolves.toEqual([])
    })
  })

  describe('updatePreviewPartial', () => {
    it('calls setex with the same TTL constant used elsewhere', async () => {
      await updatePreviewPartial('id1', 'partial content')
      expect(fakeRedis.setex).toHaveBeenCalledWith('preview:id1', expect.any(Number), 'partial content')
    })

    it('propagates the error when setex rejects', async () => {
      fakeRedis.setex.mockRejectedValueOnce(new Error('boom'))
      await expect(updatePreviewPartial('id1', 'x')).rejects.toThrow('boom')
    })
  })

  describe('deletePreview', () => {
    it('deletes the preview key, the chat key, and removes from the sorted set', async () => {
      await deletePreview('id1')
      expect(fakeRedis.del).toHaveBeenCalledWith('preview:id1')
      expect(fakeRedis.del).toHaveBeenCalledWith('chat:id1')
      expect(fakeRedis.zrem).toHaveBeenCalledWith('chat:list', 'id1')
    })

    it('propagates the error when del rejects', async () => {
      fakeRedis.del.mockRejectedValueOnce(new Error('boom'))
      await expect(deletePreview('id1')).rejects.toThrow('boom')
    })
  })

  describe('cleanupExpiredChats', () => {
    it('removes only chat ids whose chat key no longer exists, and returns the removed count', async () => {
      fakeRedis.zrange.mockResolvedValueOnce(['id1', 'id2', 'id3'])
      fakeRedis.exists.mockImplementation((key: string) => {
        if (key === 'chat:id1') return Promise.resolve(1) // still exists
        if (key === 'chat:id2') return Promise.resolve(0) // expired
        if (key === 'chat:id3') return Promise.resolve(0) // expired
        return Promise.resolve(0)
      })

      const removed = await cleanupExpiredChats()

      expect(removed).toBe(2)
      expect(fakeRedis.zrem).toHaveBeenCalledTimes(2)
      expect(fakeRedis.zrem).toHaveBeenCalledWith('chat:list', 'id2')
      expect(fakeRedis.zrem).toHaveBeenCalledWith('chat:list', 'id3')
      expect(fakeRedis.zrem).not.toHaveBeenCalledWith('chat:list', 'id1')
    })

    it('returns 0 when nothing is expired', async () => {
      fakeRedis.zrange.mockResolvedValueOnce(['id1'])
      fakeRedis.exists.mockResolvedValueOnce(1)
      await expect(cleanupExpiredChats()).resolves.toBe(0)
    })

    it('swallows errors and resolves to 0', async () => {
      fakeRedis.zrange.mockRejectedValueOnce(new Error('boom'))
      await expect(cleanupExpiredChats()).resolves.toBe(0)
    })
  })
})

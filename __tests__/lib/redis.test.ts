import { describe, it, expect } from 'vitest'
import {
  getRedisClient,
  closeRedis,
  isRedisHealthy,
  cacheGet,
  cacheSet,
  cacheDelete,
  cacheDeletePattern,
} from '@/lib/redis'

// Redis is currently DISABLED in this codebase (see lib/redis.ts) — every
// export is a real, zero-I/O no-op. These assert that real, current
// behavior directly; no mocking is needed or appropriate here.
describe('lib/redis (disabled no-op client)', () => {
  it('getRedisClient returns null', () => {
    expect(getRedisClient()).toBeNull()
  })

  it('isRedisHealthy resolves to false', async () => {
    await expect(isRedisHealthy()).resolves.toBe(false)
  })

  it('cacheGet resolves to null regardless of key', async () => {
    await expect(cacheGet('x')).resolves.toBeNull()
  })

  it('closeRedis resolves without throwing', async () => {
    await expect(closeRedis()).resolves.toBeUndefined()
  })

  it('cacheSet resolves without throwing', async () => {
    await expect(cacheSet('k', 'v')).resolves.toBeUndefined()
  })

  it('cacheSet resolves without throwing when given an explicit ttl', async () => {
    await expect(cacheSet('k', { some: 'value' }, 60)).resolves.toBeUndefined()
  })

  it('cacheDelete resolves without throwing', async () => {
    await expect(cacheDelete('k')).resolves.toBeUndefined()
  })

  it('cacheDeletePattern resolves without throwing', async () => {
    await expect(cacheDeletePattern('p*')).resolves.toBeUndefined()
  })
})

import Redis from 'ioredis'

// Redis connection singleton
let redisClient: Redis | null = null
let redisUnavailable = false

/**
 * Get or create Redis client instance.
 * Returns null if Redis is not configured or unreachable.
 */
export function getRedisClient(): Redis | null {
  if (redisUnavailable) return null

  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL

    // Skip Redis entirely if no URL configured or pointing to localhost in production
    if (!redisUrl || (process.env.NODE_ENV === 'production' && redisUrl.includes('localhost'))) {
      console.log('Redis not configured — running without cache')
      redisUnavailable = true
      return null
    }

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      retryStrategy(times) {
        if (times > 3) {
          console.warn('Redis: max retries reached, giving up')
          redisUnavailable = true
          return null // stop retrying
        }
        return Math.min(times * 200, 2000)
      },
      keepAlive: 30000,
      reconnectOnError(err) {
        return err.message.includes('READONLY')
      },
    })

    redisClient.on('error', (error) => {
      console.error('Redis connection error:', error.message)
    })

    redisClient.on('connect', () => {
      console.log('Redis connected successfully')
    })

    // Attempt connection (non-blocking)
    redisClient.connect().catch(() => {
      console.warn('Redis: initial connection failed, running without cache')
      redisUnavailable = true
      redisClient = null
    })
  }

  return redisClient
}

/**
 * Close Redis connection (for graceful shutdown)
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit()
    redisClient = null
  }
}

/**
 * Health check for Redis connection
 */
export async function isRedisHealthy(): Promise<boolean> {
  try {
    const client = getRedisClient()
    if (!client) return false
    const result = await client.ping()
    return result === 'PONG'
  } catch (error) {
    return false
  }
}

/**
 * Cache helper: Get cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient()
    if (!client) return null
    const value = await client.get(key)
    return value ? JSON.parse(value) : null
  } catch (error) {
    return null
  }
}

/**
 * Cache helper: Set value with TTL
 */
export async function cacheSet(
  key: string,
  value: any,
  ttlSeconds: number = 300,
): Promise<void> {
  try {
    const client = getRedisClient()
    if (!client) return
    await client.setex(key, ttlSeconds, JSON.stringify(value))
  } catch (error) {
    // silently skip cache writes
  }
}

/**
 * Cache helper: Delete key
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    const client = getRedisClient()
    if (!client) return
    await client.del(key)
  } catch (error) {
    // silently skip
  }
}

/**
 * Cache helper: Delete keys by pattern
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const client = getRedisClient()
    if (!client) return
    const keys = await client.keys(pattern)
    if (keys.length > 0) {
      await client.del(...keys)
    }
  } catch (error) {
    // silently skip
  }
}

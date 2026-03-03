import Redis from 'ioredis'

// Redis connection singleton
let redisClient: Redis | null = null

/**
 * Get or create Redis client instance
 * Uses singleton pattern to reuse connection across hot reloads
 */
export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379'

    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy(times) {
        const delay = Math.min(times * 50, 2000)
        return delay
      },
      // Enable keepalive to prevent connection drops
      keepAlive: 30000,
      // Reconnect on error
      reconnectOnError(err) {
        const targetError = 'READONLY'
        if (err.message.includes(targetError)) {
          // Only reconnect when the error contains "READONLY"
          return true
        }
        return false
      },
    })

    redisClient.on('error', (error) => {
      console.error('Redis connection error:', error)
    })

    redisClient.on('connect', () => {
      console.log('Redis connected successfully')
    })

    redisClient.on('ready', () => {
      console.log('Redis client ready')
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
    const result = await client.ping()
    return result === 'PONG'
  } catch (error) {
    console.error('Redis health check failed:', error)
    return false
  }
}

/**
 * Cache helper: Get cached value
 */
export async function cacheGet<T>(key: string): Promise<T | null> {
  try {
    const client = getRedisClient()
    const value = await client.get(key)
    return value ? JSON.parse(value) : null
  } catch (error) {
    console.error('Redis cache get error:', error)
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
    await client.setex(key, ttlSeconds, JSON.stringify(value))
  } catch (error) {
    console.error('Redis cache set error:', error)
  }
}

/**
 * Cache helper: Delete key
 */
export async function cacheDelete(key: string): Promise<void> {
  try {
    const client = getRedisClient()
    await client.del(key)
  } catch (error) {
    console.error('Redis cache delete error:', error)
  }
}

/**
 * Cache helper: Delete keys by pattern
 */
export async function cacheDeletePattern(pattern: string): Promise<void> {
  try {
    const client = getRedisClient()
    const keys = await client.keys(pattern)
    if (keys.length > 0) {
      await client.del(...keys)
    }
  } catch (error) {
    console.error('Redis cache delete pattern error:', error)
  }
}

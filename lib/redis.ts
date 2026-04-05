import Redis from 'ioredis'

// Redis connection singleton
let redisClient: Redis | null = null
let redisUnavailable = true // Default to unavailable — only enable after successful connect

/**
 * Get or create Redis client instance.
 * Returns null if Redis is not configured or unreachable.
 */
export function getRedisClient(): Redis | null {
  if (!redisClient && redisUnavailable) return null
  return redisClient
}

// Initialize Redis connection at module load (non-blocking)
function initRedis() {
  const redisUrl = process.env.REDIS_URL
  if (!redisUrl) {
    console.log('[Redis] No REDIS_URL — running without cache')
    return
  }

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
      connectTimeout: 5000,
      retryStrategy(times) {
        if (times > 2) {
          console.warn('[Redis] Connection failed after retries, disabling')
          return null
        }
        return Math.min(times * 500, 2000)
      },
    })

    // CRITICAL: Attach error handler BEFORE connecting to prevent unhandled errors
    client.on('error', () => {
      // Silently swallow — prevents Node.js crash from unhandled error events
    })

    client.on('connect', () => {
      console.log('[Redis] Connected successfully')
      redisClient = client
      redisUnavailable = false
    })

    client.on('close', () => {
      redisClient = null
      redisUnavailable = true
    })

    client.connect().catch(() => {
      console.warn('[Redis] Initial connection failed — running without cache')
      client.disconnect()
    })
  } catch (e) {
    console.warn('[Redis] Failed to initialize:', e)
  }
}

initRedis()

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

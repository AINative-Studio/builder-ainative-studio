// Redis DISABLED — ioredis connection errors flood the Node.js event loop
// and block ALL API calls from completing. The cache is not worth the risk.
// All cache functions are no-ops that return null/void.

export function getRedisClient(): null { return null }
export async function closeRedis(): Promise<void> {}
export async function isRedisHealthy(): Promise<boolean> { return false }
export async function cacheGet<T>(_key: string): Promise<T | null> { return null }
export async function cacheSet(_key: string, _value: any, _ttlSeconds: number = 300): Promise<void> {}
export async function cacheDelete(_key: string): Promise<void> {}
export async function cacheDeletePattern(_pattern: string): Promise<void> {}

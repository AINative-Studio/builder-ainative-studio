/**
 * Schema Change Detection Worker (US-059)
 *
 * Monitors ZeroDB for schema changes and invalidates cache when detected.
 *
 * Features:
 * - Poll ZeroDB for schema version every 5 minutes
 * - Invalidate Redis cache if schema changed
 * - Log schema changes for audit trail
 * - Automatic retry on failures
 *
 * Test Coverage Requirement: 80%
 */

import { getZeroDBClient, ZeroDBSchemaVersion } from '../mcp/zerodb-client'
import { invalidateSchemaCache, invalidateAllSchemaCaches } from '../services/schema.service'
import { cacheGet, cacheSet } from '../redis'
import { logger } from '../logger'

const POLL_INTERVAL = 5 * 60 * 1000 // 5 minutes
const VERSION_CACHE_KEY = 'zerodb:schema:versions'

/**
 * Schema version cache entry
 */
interface VersionCacheEntry {
  tableName: string
  version: string
  checksum: string
  lastChecked: string
}

/**
 * Schema change event
 */
export interface SchemaChangeEvent {
  tableName: string
  previousVersion: string
  newVersion: string
  previousChecksum: string
  newChecksum: string
  detectedAt: string
}

/**
 * Schema change detector state
 */
let isRunning = false
let intervalId: NodeJS.Timeout | null = null
let changeListeners: Array<(event: SchemaChangeEvent) => void> = []

/**
 * Start schema change detection worker
 * US-059: Poll ZeroDB for schema version every 5 minutes
 */
export function startSchemaChangeDetection(): void {
  if (isRunning) {
    logger.warn('Schema change detection already running')
    return
  }

  logger.info('Starting schema change detection worker', {
    pollInterval: `${POLL_INTERVAL / 1000}s`,
  })

  isRunning = true

  // Run immediately on start
  checkSchemaChanges().catch((error) => {
    logger.error('Initial schema check failed', error as Error)
  })

  // Then run on interval
  intervalId = setInterval(() => {
    checkSchemaChanges().catch((error) => {
      logger.error('Schema check failed', error as Error)
    })
  }, POLL_INTERVAL)
}

/**
 * Stop schema change detection worker
 */
export function stopSchemaChangeDetection(): void {
  if (!isRunning) {
    logger.warn('Schema change detection not running')
    return
  }

  logger.info('Stopping schema change detection worker')

  if (intervalId) {
    clearInterval(intervalId)
    intervalId = null
  }

  isRunning = false
}

/**
 * Check if worker is running
 */
export function isSchemaChangeDetectionRunning(): boolean {
  return isRunning
}

/**
 * Add listener for schema changes
 */
export function onSchemaChange(
  listener: (event: SchemaChangeEvent) => void
): () => void {
  changeListeners.push(listener)

  // Return unsubscribe function
  return () => {
    changeListeners = changeListeners.filter((l) => l !== listener)
  }
}

/**
 * Check for schema changes
 * US-059: Invalidate Redis cache if schema changed
 * US-059: Log schema changes
 */
async function checkSchemaChanges(): Promise<void> {
  try {
    logger.info('Checking for schema changes...')

    const client = getZeroDBClient()

    // Check if client is connected
    if (!client.isConnected()) {
      logger.warn('ZeroDB client not connected, skipping schema check')
      return
    }

    // Get current global schema version
    const currentVersion = await client.getSchemaVersion()

    if (!currentVersion) {
      logger.warn('Failed to fetch current schema version')
      return
    }

    // Get cached version
    const cachedVersions = await getCachedVersions()
    const cachedGlobalVersion = cachedVersions.get('__global__')

    // Check if global schema changed
    if (cachedGlobalVersion && cachedGlobalVersion.checksum !== currentVersion.checksum) {
      logger.info('Global schema change detected', {
        previousVersion: cachedGlobalVersion.version,
        newVersion: currentVersion.version,
        previousChecksum: cachedGlobalVersion.checksum,
        newChecksum: currentVersion.checksum,
      })

      // Invalidate all caches
      await invalidateAllSchemaCaches()

      // Emit change event
      const event: SchemaChangeEvent = {
        tableName: '__global__',
        previousVersion: cachedGlobalVersion.version,
        newVersion: currentVersion.version,
        previousChecksum: cachedGlobalVersion.checksum,
        newChecksum: currentVersion.checksum,
        detectedAt: new Date().toISOString(),
      }

      emitSchemaChange(event)

      // Update cached version
      await updateCachedVersion('__global__', currentVersion)

      logger.info('Schema change processed', { tableName: '__global__' })
    } else if (!cachedGlobalVersion) {
      // First time checking - initialize cache
      logger.info('Initializing schema version cache', {
        version: currentVersion.version,
      })

      await updateCachedVersion('__global__', currentVersion)
    } else {
      logger.info('No schema changes detected')
    }

    // Check individual tables (optional - can be enabled for more granular detection)
    // await checkIndividualTableChanges(client, cachedVersions)
  } catch (error) {
    logger.error('Failed to check schema changes', error as Error)
    throw error
  }
}

/**
 * Check individual table schema changes (optional feature)
 */
async function checkIndividualTableChanges(
  client: ReturnType<typeof getZeroDBClient>,
  cachedVersions: Map<string, VersionCacheEntry>
): Promise<void> {
  try {
    // Get list of tables
    const tables = await client.listTables()

    if (!tables || tables.length === 0) {
      logger.info('No tables to check')
      return
    }

    // Check each table
    for (const tableName of tables) {
      try {
        const currentVersion = await client.getSchemaVersion(tableName)

        if (!currentVersion) {
          continue
        }

        const cachedVersion = cachedVersions.get(tableName)

        if (cachedVersion && cachedVersion.checksum !== currentVersion.checksum) {
          logger.info('Table schema change detected', {
            tableName,
            previousVersion: cachedVersion.version,
            newVersion: currentVersion.version,
          })

          // Invalidate table cache
          await invalidateSchemaCache(tableName)

          // Emit change event
          const event: SchemaChangeEvent = {
            tableName,
            previousVersion: cachedVersion.version,
            newVersion: currentVersion.version,
            previousChecksum: cachedVersion.checksum,
            newChecksum: currentVersion.checksum,
            detectedAt: new Date().toISOString(),
          }

          emitSchemaChange(event)

          // Update cached version
          await updateCachedVersion(tableName, currentVersion)
        } else if (!cachedVersion) {
          // Initialize cache for new table
          await updateCachedVersion(tableName, currentVersion)
        }
      } catch (error) {
        logger.error('Failed to check table schema', error as Error, { tableName })
      }
    }
  } catch (error) {
    logger.error('Failed to check individual table changes', error as Error)
  }
}

/**
 * Get cached schema versions
 */
async function getCachedVersions(): Promise<Map<string, VersionCacheEntry>> {
  try {
    const cached = await cacheGet<VersionCacheEntry[]>(VERSION_CACHE_KEY)

    if (!cached) {
      return new Map()
    }

    const map = new Map<string, VersionCacheEntry>()
    cached.forEach((entry) => {
      map.set(entry.tableName, entry)
    })

    return map
  } catch (error) {
    logger.error('Failed to get cached versions', error as Error)
    return new Map()
  }
}

/**
 * Update cached version for a table
 */
async function updateCachedVersion(
  tableName: string,
  version: ZeroDBSchemaVersion
): Promise<void> {
  try {
    const cached = await getCachedVersions()

    cached.set(tableName, {
      tableName,
      version: version.version,
      checksum: version.checksum,
      lastChecked: new Date().toISOString(),
    })

    const array = Array.from(cached.values())
    await cacheSet(VERSION_CACHE_KEY, array, 7 * 24 * 3600) // Cache for 7 days
  } catch (error) {
    logger.error('Failed to update cached version', error as Error, { tableName })
  }
}

/**
 * Emit schema change event to all listeners
 */
function emitSchemaChange(event: SchemaChangeEvent): void {
  logger.info('Emitting schema change event', {
    tableName: event.tableName,
    listeners: changeListeners.length,
  })

  changeListeners.forEach((listener) => {
    try {
      listener(event)
    } catch (error) {
      logger.error('Schema change listener error', error as Error, {
        tableName: event.tableName,
      })
    }
  })
}

/**
 * Force immediate schema check (for testing/manual triggers)
 */
export async function forceSchemaCheck(): Promise<void> {
  logger.info('Forcing schema check...')
  await checkSchemaChanges()
}

/**
 * Get schema change history (from logs or database)
 * This is a placeholder - you'd typically store this in a database
 */
export async function getSchemaChangeHistory(
  limit: number = 50
): Promise<SchemaChangeEvent[]> {
  // TODO: Implement persistent storage of schema changes
  // For now, return empty array
  logger.warn('Schema change history not implemented yet')
  return []
}

/**
 * Clear all cached versions (for testing/maintenance)
 */
export async function clearVersionCache(): Promise<void> {
  try {
    const { cacheDelete } = await import('../redis')
    await cacheDelete(VERSION_CACHE_KEY)
    logger.info('Version cache cleared')
  } catch (error) {
    logger.error('Failed to clear version cache', error as Error)
  }
}

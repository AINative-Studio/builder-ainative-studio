/**
 * ZeroDB MCP Client (US-052)
 *
 * Connects to the ZeroDB MCP server to introspect database schemas
 * and execute secure database operations.
 *
 * Features:
 * - API-based connection with project credentials
 * - Connection health check on startup
 * - Retry logic with exponential backoff (1s → 2s → 4s)
 * - Error handling and graceful degradation
 * - Schema introspection and CRUD operations
 *
 * Test Coverage Requirement: 90%
 */

import { logger } from '../logger'

/**
 * Column definition from ZeroDB schema
 */
export interface ZeroDBColumn {
  name: string
  type: string // e.g., 'UUID', 'VARCHAR', 'INTEGER', 'BOOLEAN', 'TIMESTAMP'
  nullable: boolean
  default: string | null
  maxLength?: number
  isPrimaryKey?: boolean
  isUnique?: boolean
  references?: {
    table: string
    column: string
  }
}

/**
 * Index definition from ZeroDB schema
 */
export interface ZeroDBIndex {
  name: string
  columns: string[]
  unique: boolean
  type: string // e.g., 'BTREE', 'HASH'
}

/**
 * Complete table schema from ZeroDB
 */
export interface ZeroDBTableSchema {
  tableName: string
  columns: ZeroDBColumn[]
  primaryKey: string[]
  indexes: ZeroDBIndex[]
  foreignKeys?: {
    column: string
    referencesTable: string
    referencesColumn: string
  }[]
}

/**
 * Schema version info for change detection
 */
export interface ZeroDBSchemaVersion {
  version: string
  updatedAt: string
  checksum: string
}

/**
 * CRUD operation types
 */
export type CRUDOperation = 'CREATE' | 'READ' | 'UPDATE' | 'DELETE' | 'LIST'

/**
 * CRUD request payload
 */
export interface CRUDRequest {
  operation: CRUDOperation
  table: string
  data?: Record<string, any>
  where?: Record<string, any>
  limit?: number
  offset?: number
  orderBy?: { column: string; direction: 'ASC' | 'DESC' }[]
}

/**
 * CRUD response
 */
export interface CRUDResponse {
  success: boolean
  data?: any
  count?: number
  error?: string
}

/**
 * MCP Health Check Response
 */
export interface MCPHealthResponse {
  status: 'healthy' | 'degraded' | 'unhealthy'
  version: string
  uptime: number
  database: {
    connected: boolean
    latency?: number
  }
}

class ZeroDBMCPClient {
  private baseUrl: string
  private apiKey: string
  private projectId: string
  private connected: boolean = false
  private maxRetries: number = 3
  private baseDelay: number = 1000 // 1 second

  constructor() {
    // Use actual env var names from root .env
    this.baseUrl = process.env.ZERODB_API_BASE_URL || process.env.ZERODB_MCP_URL || 'https://api.ainative.studio'
    this.apiKey = process.env.ZERODB_API_KEY || process.env.ZERODB_MCP_API_KEY || ''
    this.projectId = process.env.ZERODB_PROJECT_ID || ''

    if (!process.env.ZERODB_API_BASE_URL && !process.env.ZERODB_MCP_URL) {
      logger.warn('ZERODB_API_BASE_URL not set, using default: https://api.ainative.studio')
    }

    if (!this.apiKey) {
      logger.warn('ZERODB_API_KEY not set - ZeroDB features will be disabled')
    }

    if (!this.projectId) {
      logger.info('ZERODB_PROJECT_ID not set - using API key authentication')
    }
  }

  /**
   * Connect to the MCP server and verify health
   * US-052: Connection tested on app startup
   */
  async connect(): Promise<boolean> {
    try {
      logger.info('Connecting to ZeroDB MCP server...')

      // Skip if credentials not configured (API key is required, project ID is optional)
      if (!this.apiKey) {
        logger.warn('ZeroDB API key not configured, skipping connection')
        this.connected = false
        return false
      }

      const healthCheck = await this.retryRequest(async () => {
        const response = await fetch(`${this.baseUrl}/health`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (!response.ok) {
          throw new Error(`Health check failed: ${response.status} ${response.statusText}`)
        }

        return response.json()
      })

      this.connected = true
      logger.info('Successfully connected to ZeroDB MCP server', { healthCheck })
      return true
    } catch (error) {
      logger.error('Failed to connect to ZeroDB MCP server', error as Error)
      this.connected = false
      return false
    }
  }

  /**
   * Disconnect from the MCP server
   */
  async disconnect(): Promise<void> {
    this.connected = false
    logger.info('Disconnected from ZeroDB MCP server')
  }

  /**
   * Get table schema from ZeroDB
   * US-053: Fetch table schemas with columns, primary keys, and indexes
   */
  async getTableSchema(tableName: string): Promise<ZeroDBTableSchema | null> {
    if (!this.ensureConnected()) {
      return null
    }

    try {
      const response = await this.retryRequest(async () => {
        const res = await fetch(`${this.baseUrl}/schema/${tableName}`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (!res.ok) {
          if (res.status === 404) {
            throw new Error(`Table '${tableName}' not found`)
          }
          throw new Error(`Schema fetch failed: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      logger.info('Successfully fetched table schema', {
        tableName,
        columnCount: response.columns?.length || 0,
      })

      return response as ZeroDBTableSchema
    } catch (error) {
      logger.error('Failed to fetch table schema', error as Error, { tableName })
      return null
    }
  }

  /**
   * Get current schema version for change detection
   * US-059: Schema change detection
   */
  async getSchemaVersion(tableName?: string): Promise<ZeroDBSchemaVersion | null> {
    if (!this.ensureConnected()) {
      return null
    }

    try {
      const endpoint = tableName
        ? `${this.baseUrl}/schema/${tableName}/version`
        : `${this.baseUrl}/schema/version`

      const response = await this.retryRequest(async () => {
        const res = await fetch(endpoint, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (!res.ok) {
          throw new Error(`Version fetch failed: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      return response as ZeroDBSchemaVersion
    } catch (error) {
      logger.error('Failed to fetch schema version', error as Error, { tableName })
      return null
    }
  }

  /**
   * List all tables in the database
   */
  async listTables(): Promise<string[] | null> {
    if (!this.ensureConnected()) {
      return null
    }

    try {
      const response = await this.retryRequest(async () => {
        const res = await fetch(`${this.baseUrl}/schema/tables`, {
          method: 'GET',
          headers: this.getHeaders(),
        })

        if (!res.ok) {
          throw new Error(`Table list failed: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      logger.info('Successfully fetched table list', {
        tableCount: response.tables?.length || 0,
      })

      return response.tables || []
    } catch (error) {
      logger.error('Failed to fetch table list', error as Error)
      return null
    }
  }

  /**
   * Execute CRUD operation via MCP
   * US-056: CRUD operations (GET list, GET single, POST, PUT, DELETE)
   */
  async executeCRUD(request: CRUDRequest): Promise<CRUDResponse> {
    if (!this.ensureConnected()) {
      return {
        success: false,
        error: 'ZeroDB MCP client not connected',
      }
    }

    try {
      const response = await this.retryRequest(async () => {
        const res = await fetch(`${this.baseUrl}/data/${request.table}`, {
          method: 'POST',
          headers: this.getHeaders(),
          body: JSON.stringify(request),
        })

        if (!res.ok) {
          throw new Error(`CRUD operation failed: ${res.status} ${res.statusText}`)
        }

        return res.json()
      })

      logger.info('CRUD operation executed', {
        operation: request.operation,
        table: request.table,
        success: response.success,
      })

      return response as CRUDResponse
    } catch (error) {
      logger.error('Failed to execute CRUD operation', error as Error, {
        operation: request.operation,
        table: request.table,
      })
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }

  /**
   * Check if the client is connected
   */
  isConnected(): boolean {
    return this.connected
  }

  /**
   * Get common headers for API requests
   * US-052: Authentication via project credentials
   */
  private getHeaders(): HeadersInit {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${this.apiKey}`,
      'X-Client-Version': '1.0.0',
    }

    // Only include project ID if it's set
    if (this.projectId) {
      headers['X-Project-ID'] = this.projectId
    }

    return headers
  }

  /**
   * Ensure connection or attempt to reconnect
   * US-052: Error handling for connection failures
   */
  private ensureConnected(): boolean {
    if (!this.connected) {
      logger.warn('ZeroDB MCP client not connected')
      return false
    }
    return true
  }

  /**
   * Retry a request with exponential backoff
   * US-052: Exponential backoff (1s → 2s → 4s)
   */
  private async retryRequest<T>(
    requestFn: () => Promise<T>,
    attempt: number = 1
  ): Promise<T> {
    try {
      return await requestFn()
    } catch (error) {
      if (attempt >= this.maxRetries) {
        logger.error(`Request failed after ${this.maxRetries} attempts`, error as Error)
        throw error
      }

      const delay = this.baseDelay * Math.pow(2, attempt - 1) // 1s → 2s → 4s
      logger.warn(`Request attempt ${attempt} failed, retrying in ${delay}ms...`, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })

      await new Promise((resolve) => setTimeout(resolve, delay))
      return this.retryRequest(requestFn, attempt + 1)
    }
  }
}

// Singleton instance
let zerodbClientInstance: ZeroDBMCPClient | null = null

/**
 * Get or create the ZeroDB MCP client instance
 */
export function getZeroDBClient(): ZeroDBMCPClient {
  if (!zerodbClientInstance) {
    zerodbClientInstance = new ZeroDBMCPClient()
  }
  return zerodbClientInstance
}

/**
 * Initialize ZeroDB MCP client connection on app startup
 * US-052: Connection tested on app startup
 */
export async function initializeZeroDBClient(): Promise<boolean> {
  const client = getZeroDBClient()
  return client.connect()
}

export default ZeroDBMCPClient

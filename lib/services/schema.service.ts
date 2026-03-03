/**
 * Schema Service (US-053)
 *
 * Service layer for fetching and caching ZeroDB table schemas.
 * Integrates with ZeroDB MCP client and Redis cache.
 *
 * Features:
 * - Fetch table schemas with columns, primary keys, and indexes
 * - Redis caching with 1-hour TTL
 * - Cache invalidation support
 * - Validation rules extraction
 *
 * Test Coverage Requirement: 90%
 */

import { getZeroDBClient, ZeroDBTableSchema, ZeroDBColumn } from '../mcp/zerodb-client'
import { cacheGet, cacheSet, cacheDelete } from '../redis'
import { logger } from '../logger'

const SCHEMA_CACHE_TTL = 3600 // 1 hour in seconds
const SCHEMA_CACHE_PREFIX = 'zerodb:schema:'

/**
 * Validation rule derived from column definition
 */
export interface ValidationRule {
  field: string
  type: string
  required: boolean
  maxLength?: number
  unique?: boolean
  enum?: string[]
  pattern?: string
  foreignKey?: {
    table: string
    column: string
  }
}

/**
 * Enhanced schema with validation rules
 */
export interface EnhancedTableSchema extends ZeroDBTableSchema {
  validationRules: ValidationRule[]
  displayName: string
}

/**
 * Get table schema with caching
 * US-053: Returns columns (name, type, nullable, default), primary key, indexes
 * US-053: Response cached in Redis (1 hour TTL)
 */
export async function getTableSchema(
  tableName: string
): Promise<EnhancedTableSchema | null> {
  try {
    // Check cache first
    const cacheKey = `${SCHEMA_CACHE_PREFIX}${tableName}`
    const cached = await cacheGet<EnhancedTableSchema>(cacheKey)

    if (cached) {
      logger.info('Schema cache hit', { tableName })
      return cached
    }

    logger.info('Schema cache miss, fetching from ZeroDB', { tableName })

    // Fetch from ZeroDB MCP
    const client = getZeroDBClient()
    const schema = await client.getTableSchema(tableName)

    if (!schema) {
      logger.warn('Table schema not found', { tableName })
      return null
    }

    // Enhance schema with validation rules
    const enhancedSchema = enhanceSchema(schema)

    // Cache the result
    await cacheSet(cacheKey, enhancedSchema, SCHEMA_CACHE_TTL)

    logger.info('Schema fetched and cached', {
      tableName,
      columnCount: schema.columns.length,
    })

    return enhancedSchema
  } catch (error) {
    logger.error('Failed to get table schema', error as Error, { tableName })
    return null
  }
}

/**
 * Get multiple table schemas at once
 */
export async function getMultipleTableSchemas(
  tableNames: string[]
): Promise<Map<string, EnhancedTableSchema>> {
  const schemas = new Map<string, EnhancedTableSchema>()

  await Promise.all(
    tableNames.map(async (tableName) => {
      const schema = await getTableSchema(tableName)
      if (schema) {
        schemas.set(tableName, schema)
      }
    })
  )

  return schemas
}

/**
 * List all available tables
 */
export async function listTables(): Promise<string[]> {
  try {
    // Check cache first
    const cacheKey = `${SCHEMA_CACHE_PREFIX}__list__`
    const cached = await cacheGet<string[]>(cacheKey)

    if (cached) {
      logger.info('Table list cache hit')
      return cached
    }

    // Fetch from ZeroDB MCP
    const client = getZeroDBClient()
    const tables = await client.listTables()

    if (!tables) {
      logger.warn('Failed to fetch table list')
      return []
    }

    // Cache the result (shorter TTL for list)
    await cacheSet(cacheKey, tables, 300) // 5 minutes

    logger.info('Table list fetched and cached', { count: tables.length })

    return tables
  } catch (error) {
    logger.error('Failed to list tables', error as Error)
    return []
  }
}

/**
 * Invalidate schema cache for a table
 * US-059: Cache invalidation on schema changes
 */
export async function invalidateSchemaCache(tableName: string): Promise<void> {
  try {
    const cacheKey = `${SCHEMA_CACHE_PREFIX}${tableName}`
    await cacheDelete(cacheKey)
    logger.info('Schema cache invalidated', { tableName })
  } catch (error) {
    logger.error('Failed to invalidate schema cache', error as Error, { tableName })
  }
}

/**
 * Invalidate all schema caches
 */
export async function invalidateAllSchemaCaches(): Promise<void> {
  try {
    // Note: This is a simplified version. In production, you'd use Redis SCAN
    // to find and delete all keys matching the pattern
    await cacheDelete(`${SCHEMA_CACHE_PREFIX}__list__`)
    logger.info('All schema caches invalidated')
  } catch (error) {
    logger.error('Failed to invalidate all schema caches', error as Error)
  }
}

/**
 * Enhance schema with validation rules
 * US-055: Include validation rules (required, max length, etc.)
 */
function enhanceSchema(schema: ZeroDBTableSchema): EnhancedTableSchema {
  const validationRules: ValidationRule[] = schema.columns.map((column) =>
    extractValidationRules(column)
  )

  // Generate display name from table name
  const displayName = schema.tableName
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ')

  return {
    ...schema,
    validationRules,
    displayName,
  }
}

/**
 * Extract validation rules from column definition
 * US-055: Validation rules (required, max length, etc.)
 */
function extractValidationRules(column: ZeroDBColumn): ValidationRule {
  const rule: ValidationRule = {
    field: column.name,
    type: mapDatabaseTypeToValidationType(column.type),
    required: !column.nullable,
  }

  // Add max length for string types
  if (column.maxLength) {
    rule.maxLength = column.maxLength
  }

  // Add unique constraint
  if (column.isUnique) {
    rule.unique = true
  }

  // Add foreign key reference
  if (column.references) {
    rule.foreignKey = {
      table: column.references.table,
      column: column.references.column,
    }
  }

  // Add pattern for specific types
  if (column.type === 'EMAIL') {
    rule.pattern = '^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$'
  } else if (column.type === 'URL') {
    rule.pattern = '^https?://.+$'
  } else if (column.type === 'UUID') {
    rule.pattern = '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
  }

  // Extract enum values from type if present (e.g., "ENUM('admin','user')")
  if (column.type.startsWith('ENUM')) {
    const enumMatch = column.type.match(/ENUM\((.*)\)/)
    if (enumMatch) {
      rule.enum = enumMatch[1]
        .split(',')
        .map((v) => v.trim().replace(/['"]/g, ''))
    }
  }

  return rule
}

/**
 * Map database types to validation types
 */
function mapDatabaseTypeToValidationType(dbType: string): string {
  const type = dbType.toUpperCase()

  if (type.includes('INT') || type === 'SERIAL' || type === 'BIGSERIAL') {
    return 'integer'
  }
  if (type.includes('FLOAT') || type.includes('DECIMAL') || type.includes('NUMERIC')) {
    return 'number'
  }
  if (type === 'BOOLEAN' || type === 'BOOL') {
    return 'boolean'
  }
  if (type.includes('DATE') || type.includes('TIME')) {
    return 'datetime'
  }
  if (type === 'UUID') {
    return 'uuid'
  }
  if (type === 'EMAIL') {
    return 'email'
  }
  if (type === 'URL') {
    return 'url'
  }
  if (type.includes('JSON')) {
    return 'json'
  }
  if (type.startsWith('ENUM')) {
    return 'enum'
  }

  // Default to string for VARCHAR, TEXT, etc.
  return 'string'
}

/**
 * Format schema for LLM consumption
 * US-055: Schema formatted for prompts
 */
export function formatSchemaForPrompt(schema: EnhancedTableSchema): string {
  const parts: string[] = [
    `Table: ${schema.displayName} (${schema.tableName})`,
    `Columns:`,
  ]

  schema.columns.forEach((column) => {
    const attributes: string[] = []

    // Type
    attributes.push(column.type.toLowerCase())

    // Constraints
    if (column.isPrimaryKey) attributes.push('primary key')
    if (!column.nullable) attributes.push('required')
    if (column.isUnique) attributes.push('unique')
    if (column.maxLength) attributes.push(`max: ${column.maxLength}`)
    if (column.default !== null) attributes.push(`default: ${column.default}`)
    if (column.references) {
      attributes.push(`→ ${column.references.table}.${column.references.column}`)
    }

    parts.push(`  - ${column.name} (${attributes.join(', ')})`)
  })

  // Add primary key info
  if (schema.primaryKey.length > 0) {
    parts.push(`Primary Key: ${schema.primaryKey.join(', ')}`)
  }

  // Add indexes
  if (schema.indexes.length > 0) {
    parts.push(`Indexes:`)
    schema.indexes.forEach((index) => {
      const type = index.unique ? 'unique' : 'index'
      parts.push(`  - ${index.name}: ${type} on [${index.columns.join(', ')}]`)
    })
  }

  return parts.join('\n')
}

/**
 * Get validation rules summary
 */
export function getValidationRulesSummary(schema: EnhancedTableSchema): string {
  const rules: string[] = []

  schema.validationRules.forEach((rule) => {
    const constraints: string[] = []

    if (rule.required) constraints.push('required')
    if (rule.maxLength) constraints.push(`max length: ${rule.maxLength}`)
    if (rule.unique) constraints.push('must be unique')
    if (rule.enum) constraints.push(`one of: ${rule.enum.join(', ')}`)
    if (rule.pattern) constraints.push('must match pattern')

    if (constraints.length > 0) {
      rules.push(`${rule.field}: ${constraints.join(', ')}`)
    }
  })

  return rules.join('\n')
}

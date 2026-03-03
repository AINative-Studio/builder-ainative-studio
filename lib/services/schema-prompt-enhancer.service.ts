/**
 * Schema Prompt Enhancer Service (US-055)
 *
 * Injects ZeroDB schema information into prompts for accurate CRUD UI generation.
 *
 * Features:
 * - Schema formatted for LLM consumption
 * - Validation rules included (required, max length, etc.)
 * - Appends to system prompt
 * - Supports multiple tables
 *
 * Test Coverage Requirement: 90%
 */

import {
  getTableSchema,
  getMultipleTableSchemas,
  formatSchemaForPrompt,
  getValidationRulesSummary,
  EnhancedTableSchema,
} from './schema.service'
import { detectCRUDIntent } from './crud-intent-detector.service'
import { logger } from '../logger'

/**
 * Enhanced prompt with schema information
 */
export interface EnhancedPrompt {
  originalPrompt: string
  enhancedSystemPrompt: string
  enhancedUserPrompt: string
  schemasUsed: string[]
  metadata: {
    tablesDetected: number
    validationRulesCount: number
    enhancementApplied: boolean
  }
}

/**
 * Schema enhancement options
 */
export interface SchemaEnhancementOptions {
  includeValidationRules?: boolean
  includeIndexes?: boolean
  includeForeignKeys?: boolean
  includeExamples?: boolean
  maxTables?: number
}

const DEFAULT_OPTIONS: Required<SchemaEnhancementOptions> = {
  includeValidationRules: true,
  includeIndexes: true,
  includeForeignKeys: true,
  includeExamples: true,
  maxTables: 5,
}

/**
 * Enhance prompt with schema information
 * US-055: Schema formatted and appended to system prompt
 * US-055: Include validation rules
 */
export async function enhancePromptWithSchema(
  userPrompt: string,
  systemPrompt: string,
  options: SchemaEnhancementOptions = {}
): Promise<EnhancedPrompt> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  try {
    // Detect if CRUD intent exists
    const crudIntent = detectCRUDIntent(userPrompt)

    if (!crudIntent.detected || !crudIntent.tableName) {
      logger.info('No CRUD intent detected, skipping schema enhancement')
      return {
        originalPrompt: userPrompt,
        enhancedSystemPrompt: systemPrompt,
        enhancedUserPrompt: userPrompt,
        schemasUsed: [],
        metadata: {
          tablesDetected: 0,
          validationRulesCount: 0,
          enhancementApplied: false,
        },
      }
    }

    logger.info('CRUD intent detected, enhancing prompt with schema', {
      tableName: crudIntent.tableName,
      confidence: crudIntent.confidence,
    })

    // Fetch schema for detected table
    const schema = await getTableSchema(crudIntent.tableName)

    if (!schema) {
      logger.warn('Schema not found for table', { tableName: crudIntent.tableName })
      return {
        originalPrompt: userPrompt,
        enhancedSystemPrompt: systemPrompt,
        enhancedUserPrompt: userPrompt,
        schemasUsed: [],
        metadata: {
          tablesDetected: 0,
          validationRulesCount: 0,
          enhancementApplied: false,
        },
      }
    }

    // Build schema enhancement
    const schemaEnhancement = buildSchemaEnhancement([schema], opts)

    // Enhance system prompt
    const enhancedSystemPrompt = `${systemPrompt}

${schemaEnhancement}`

    // Enhance user prompt with table context
    const enhancedUserPrompt = enhanceUserPrompt(userPrompt, schema, crudIntent.operation)

    logger.info('Prompt enhanced with schema', {
      tableName: schema.tableName,
      columnsIncluded: schema.columns.length,
    })

    return {
      originalPrompt: userPrompt,
      enhancedSystemPrompt,
      enhancedUserPrompt,
      schemasUsed: [schema.tableName],
      metadata: {
        tablesDetected: 1,
        validationRulesCount: schema.validationRules.length,
        enhancementApplied: true,
      },
    }
  } catch (error) {
    logger.error('Failed to enhance prompt with schema', error as Error)

    // Return original prompts on error
    return {
      originalPrompt: userPrompt,
      enhancedSystemPrompt: systemPrompt,
      enhancedUserPrompt: userPrompt,
      schemasUsed: [],
      metadata: {
        tablesDetected: 0,
        validationRulesCount: 0,
        enhancementApplied: false,
      },
    }
  }
}

/**
 * Enhance prompt with multiple table schemas
 */
export async function enhancePromptWithMultipleSchemas(
  userPrompt: string,
  systemPrompt: string,
  tableNames: string[],
  options: SchemaEnhancementOptions = {}
): Promise<EnhancedPrompt> {
  const opts = { ...DEFAULT_OPTIONS, ...options }

  try {
    // Limit number of tables
    const limitedTableNames = tableNames.slice(0, opts.maxTables)

    // Fetch all schemas
    const schemas = await getMultipleTableSchemas(limitedTableNames)

    if (schemas.size === 0) {
      logger.warn('No schemas found for tables', { tableNames: limitedTableNames })
      return {
        originalPrompt: userPrompt,
        enhancedSystemPrompt: systemPrompt,
        enhancedUserPrompt: userPrompt,
        schemasUsed: [],
        metadata: {
          tablesDetected: 0,
          validationRulesCount: 0,
          enhancementApplied: false,
        },
      }
    }

    // Build schema enhancement
    const schemaArray = Array.from(schemas.values())
    const schemaEnhancement = buildSchemaEnhancement(schemaArray, opts)

    // Enhance system prompt
    const enhancedSystemPrompt = `${systemPrompt}

${schemaEnhancement}`

    // Count total validation rules
    const totalValidationRules = schemaArray.reduce(
      (sum, schema) => sum + schema.validationRules.length,
      0
    )

    logger.info('Prompt enhanced with multiple schemas', {
      tablesIncluded: schemas.size,
      validationRules: totalValidationRules,
    })

    return {
      originalPrompt: userPrompt,
      enhancedSystemPrompt,
      enhancedUserPrompt: userPrompt,
      schemasUsed: Array.from(schemas.keys()),
      metadata: {
        tablesDetected: schemas.size,
        validationRulesCount: totalValidationRules,
        enhancementApplied: true,
      },
    }
  } catch (error) {
    logger.error('Failed to enhance prompt with multiple schemas', error as Error)

    return {
      originalPrompt: userPrompt,
      enhancedSystemPrompt: systemPrompt,
      enhancedUserPrompt: userPrompt,
      schemasUsed: [],
      metadata: {
        tablesDetected: 0,
        validationRulesCount: 0,
        enhancementApplied: false,
      },
    }
  }
}

/**
 * Build schema enhancement text for system prompt
 * US-055: Schema formatted as specified
 */
function buildSchemaEnhancement(
  schemas: EnhancedTableSchema[],
  options: Required<SchemaEnhancementOptions>
): string {
  const parts: string[] = [
    '## Database Schema Information',
    '',
    'You are building a UI that connects to the following database tables:',
    '',
  ]

  schemas.forEach((schema, index) => {
    // Add table schema
    parts.push(`### ${index + 1}. ${schema.displayName}`)
    parts.push('')
    parts.push(formatSchemaForPrompt(schema))
    parts.push('')

    // Add validation rules
    if (options.includeValidationRules && schema.validationRules.length > 0) {
      parts.push('**Validation Rules:**')
      parts.push(getValidationRulesSummary(schema))
      parts.push('')
    }

    // Add API endpoints info
    parts.push('**API Endpoints:**')
    parts.push(`- GET /api/zerodb/${schema.tableName} - List all records`)
    parts.push(`- GET /api/zerodb/${schema.tableName}/[id] - Get single record`)
    parts.push(`- POST /api/zerodb/${schema.tableName} - Create new record`)
    parts.push(`- PUT /api/zerodb/${schema.tableName}/[id] - Update record`)
    parts.push(`- DELETE /api/zerodb/${schema.tableName}/[id] - Delete record`)
    parts.push('')

    // Add examples
    if (options.includeExamples) {
      parts.push('**Example Usage:**')
      parts.push('```typescript')
      parts.push(generateExampleCode(schema))
      parts.push('```')
      parts.push('')
    }
  })

  parts.push('## Important Notes:')
  parts.push('- Use the exact table and column names shown above')
  parts.push('- Respect all validation rules and constraints')
  parts.push('- Include proper error handling for API calls')
  parts.push('- Show loading states while fetching data')
  parts.push('- Use appropriate form components for each field type')
  parts.push('')

  return parts.join('\n')
}

/**
 * Enhance user prompt with table context
 */
function enhanceUserPrompt(
  userPrompt: string,
  schema: EnhancedTableSchema,
  operation?: string
): string {
  const parts: string[] = [userPrompt]

  // Add context about the table
  parts.push('')
  parts.push(
    `Build this for the "${schema.displayName}" table with ${schema.columns.length} columns.`
  )

  // Add operation-specific guidance
  if (operation) {
    const guidance = getOperationGuidance(operation, schema)
    if (guidance) {
      parts.push(guidance)
    }
  }

  return parts.join(' ')
}

/**
 * Get operation-specific guidance
 */
function getOperationGuidance(
  operation: string,
  schema: EnhancedTableSchema
): string | null {
  switch (operation) {
    case 'create':
      return `Include a form with all required fields: ${schema.validationRules
        .filter((r) => r.required)
        .map((r) => r.field)
        .join(', ')}.`

    case 'read':
    case 'list':
      return `Display all records in a table or list format with key columns: ${schema.columns
        .slice(0, 5)
        .map((c) => c.name)
        .join(', ')}.`

    case 'update':
      return 'Include an edit form with validation and save/cancel actions.'

    case 'delete':
      return 'Include delete confirmation and error handling.'

    case 'manage':
      return 'Include full CRUD functionality: create, view, edit, and delete operations.'

    default:
      return null
  }
}

/**
 * Generate example TypeScript code for schema
 */
function generateExampleCode(schema: EnhancedTableSchema): string {
  const lines: string[] = []

  // List example
  lines.push(`// List all ${schema.tableName}`)
  lines.push(`const response = await fetch('/api/zerodb/${schema.tableName}')`)
  lines.push(`const data = await response.json()`)
  lines.push('')

  // Create example
  lines.push(`// Create new ${schema.tableName.slice(0, -1)}`)
  const requiredFields = schema.validationRules
    .filter((r) => r.required && !r.field.includes('id') && !r.field.includes('created'))
    .slice(0, 3)

  if (requiredFields.length > 0) {
    lines.push(`const newRecord = {`)
    requiredFields.forEach((field) => {
      const exampleValue = getExampleValue(field.type)
      lines.push(`  ${field.field}: ${exampleValue},`)
    })
    lines.push(`}`)
    lines.push(
      `const createResponse = await fetch('/api/zerodb/${schema.tableName}', {`
    )
    lines.push(`  method: 'POST',`)
    lines.push(`  headers: { 'Content-Type': 'application/json' },`)
    lines.push(`  body: JSON.stringify(newRecord)`)
    lines.push(`})`)
  }

  return lines.join('\n')
}

/**
 * Get example value for field type
 */
function getExampleValue(type: string): string {
  switch (type) {
    case 'string':
      return "'example'"
    case 'integer':
    case 'number':
      return '123'
    case 'boolean':
      return 'true'
    case 'email':
      return "'user@example.com'"
    case 'url':
      return "'https://example.com'"
    case 'datetime':
      return 'new Date().toISOString()'
    case 'uuid':
      return "'00000000-0000-0000-0000-000000000000'"
    case 'json':
      return '{}'
    default:
      return "'value'"
  }
}

/**
 * Extract table names from enhanced prompt metadata
 */
export function extractTableNamesFromMetadata(
  enhanced: EnhancedPrompt
): string[] {
  return enhanced.schemasUsed
}

/**
 * Check if prompt was enhanced
 */
export function wasPromptEnhanced(enhanced: EnhancedPrompt): boolean {
  return enhanced.metadata.enhancementApplied
}

/**
 * Get enhancement summary
 */
export function getEnhancementSummary(enhanced: EnhancedPrompt): string {
  if (!enhanced.metadata.enhancementApplied) {
    return 'No schema enhancement applied'
  }

  return `Enhanced with ${enhanced.metadata.tablesDetected} table(s), ${enhanced.metadata.validationRulesCount} validation rule(s)`
}

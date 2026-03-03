/**
 * CRUD Intent Detector Service (US-054)
 *
 * Detects when user wants CRUD operations and extracts table names from prompts.
 *
 * Features:
 * - Keyword detection: "CRUD", "manage", "dashboard for [table]"
 * - Table name extraction with confidence scoring
 * - Support for various phrasings and natural language
 * - Confidence threshold: 0.8 required for positive detection
 *
 * Test Coverage Requirement: 85%
 */

import { logger } from '../logger'

/**
 * CRUD intent detection result
 */
export interface CRUDIntentResult {
  detected: boolean
  confidence: number // 0.0 to 1.0
  tableName: string | null
  operation?: 'create' | 'read' | 'update' | 'delete' | 'manage' | 'list'
  reason?: string
}

/**
 * Keywords that indicate CRUD intent
 */
const CRUD_KEYWORDS = {
  // High confidence keywords (0.9+)
  high: [
    'crud',
    'manage',
    'admin panel',
    'dashboard for',
    'data table',
    'database table',
    'table editor',
    'data grid',
  ],
  // Medium confidence keywords (0.7-0.9)
  medium: [
    'list',
    'view',
    'edit',
    'create',
    'delete',
    'update',
    'add',
    'remove',
    'modify',
    'display all',
    'show all',
    'form for',
  ],
  // Operation-specific keywords
  operations: {
    create: ['create', 'add', 'new', 'insert', 'register'],
    read: ['view', 'show', 'display', 'list', 'get', 'fetch', 'see'],
    update: ['edit', 'update', 'modify', 'change', 'alter'],
    delete: ['delete', 'remove', 'destroy', 'purge'],
    manage: ['manage', 'administer', 'admin', 'control'],
  },
}

/**
 * Patterns for extracting table names
 */
const TABLE_NAME_PATTERNS = [
  // "dashboard for users"
  /(?:dashboard|panel|page|interface|ui|admin)\s+for\s+(\w+)/i,
  // "manage users table"
  /(?:manage|edit|view|show)\s+(?:the\s+)?(\w+)\s+(?:table|data|records)/i,
  // "users CRUD"
  /(\w+)\s+(?:crud|management|admin)/i,
  // "create/edit/delete users"
  /(?:create|edit|delete|update|add|remove|manage)\s+(\w+)/i,
  // "users dashboard"
  /(\w+)\s+(?:dashboard|panel|admin|manager)/i,
  // "table for users"
  /(?:table|grid|list|form)\s+(?:for|of)\s+(\w+)/i,
  // "build a users management"
  /(?:build|create|make)\s+(?:a|an)?\s*(\w+)\s+(?:management|admin|dashboard)/i,
]

/**
 * Common words to filter out (not table names)
 */
const STOP_WORDS = new Set([
  'the',
  'a',
  'an',
  'and',
  'or',
  'but',
  'for',
  'with',
  'to',
  'from',
  'in',
  'on',
  'at',
  'by',
  'data',
  'table',
  'dashboard',
  'panel',
  'page',
  'interface',
  'ui',
  'admin',
  'management',
  'crud',
  'create',
  'read',
  'update',
  'delete',
  'edit',
  'view',
  'show',
  'list',
])

/**
 * Detect CRUD intent from user prompt
 * US-054: Detect keywords and extract table name
 * US-054: Confidence score >0.8 required
 */
export function detectCRUDIntent(prompt: string): CRUDIntentResult {
  const normalizedPrompt = prompt.toLowerCase().trim()

  // Initialize result
  let confidence = 0.0
  let tableName: string | null = null
  let operation: CRUDIntentResult['operation'] = undefined
  let reason = ''

  // Check for high-confidence keywords
  for (const keyword of CRUD_KEYWORDS.high) {
    if (normalizedPrompt.includes(keyword)) {
      confidence = Math.max(confidence, 0.9)
      reason = `High-confidence keyword detected: "${keyword}"`
      logger.info('High-confidence CRUD keyword detected', { keyword, prompt })
      break
    }
  }

  // Check for medium-confidence keywords
  if (confidence < 0.9) {
    for (const keyword of CRUD_KEYWORDS.medium) {
      if (normalizedPrompt.includes(keyword)) {
        confidence = Math.max(confidence, 0.7)
        reason = `Medium-confidence keyword detected: "${keyword}"`
        logger.info('Medium-confidence CRUD keyword detected', { keyword, prompt })
        break
      }
    }
  }

  // Detect specific operation
  for (const [op, keywords] of Object.entries(CRUD_KEYWORDS.operations)) {
    for (const keyword of keywords) {
      if (normalizedPrompt.includes(keyword)) {
        operation = op as CRUDIntentResult['operation']
        // Boost confidence if operation detected
        confidence = Math.max(confidence, 0.75)
        break
      }
    }
    if (operation) break
  }

  // Extract table name
  tableName = extractTableName(normalizedPrompt)

  if (tableName) {
    // Boost confidence if we found a valid table name
    confidence = Math.min(confidence + 0.15, 1.0)
    reason += tableName ? ` | Table name: "${tableName}"` : ''
  } else {
    // Reduce confidence if no table name found
    confidence = Math.max(confidence - 0.2, 0.0)
  }

  // Check for negative patterns that reduce confidence
  if (hasNegativePatterns(normalizedPrompt)) {
    confidence *= 0.5
    reason += ' | Negative patterns detected'
  }

  const detected = confidence >= 0.8

  logger.info('CRUD intent detection complete', {
    detected,
    confidence: confidence.toFixed(2),
    tableName,
    operation,
  })

  return {
    detected,
    confidence: parseFloat(confidence.toFixed(2)),
    tableName,
    operation,
    reason: reason || 'No CRUD intent detected',
  }
}

/**
 * Extract table name from prompt using patterns
 */
function extractTableName(normalizedPrompt: string): string | null {
  // Try each pattern
  for (const pattern of TABLE_NAME_PATTERNS) {
    const match = normalizedPrompt.match(pattern)
    if (match && match[1]) {
      const candidate = match[1].toLowerCase()

      // Filter out stop words
      if (STOP_WORDS.has(candidate)) {
        continue
      }

      // Validate it looks like a table name
      if (isValidTableName(candidate)) {
        // Convert to snake_case if it's camelCase or has spaces
        return normalizeTableName(candidate)
      }
    }
  }

  // Try to find a plural noun that might be a table name
  const words = normalizedPrompt.split(/\s+/)
  for (const word of words) {
    if (
      word.length > 3 &&
      !STOP_WORDS.has(word) &&
      (word.endsWith('s') || word.endsWith('es')) &&
      isValidTableName(word)
    ) {
      return normalizeTableName(word)
    }
  }

  return null
}

/**
 * Validate if a string looks like a table name
 */
function isValidTableName(candidate: string): boolean {
  // Table names should be alphanumeric with optional underscores
  const tableNamePattern = /^[a-z][a-z0-9_]*$/i
  return tableNamePattern.test(candidate) && candidate.length >= 3
}

/**
 * Normalize table name to snake_case
 */
function normalizeTableName(name: string): string {
  // Remove special characters (keep letters, numbers, underscores)
  let cleaned = name.replace(/[^a-zA-Z0-9_]/g, '')

  // If already snake_case, return as-is
  if (cleaned.includes('_')) {
    return cleaned.toLowerCase()
  }

  // Convert camelCase to snake_case
  return cleaned.replace(/([A-Z])/g, '_$1').toLowerCase().replace(/^_/, '')
}

/**
 * Check for patterns that indicate this is NOT a CRUD request
 */
function hasNegativePatterns(prompt: string): boolean {
  const negativePatterns = [
    /landing page/i,
    /marketing/i,
    /blog post/i,
    /article/i,
    /static/i,
    /read.?only/i,
    /display.?only/i,
    /chart/i,
    /graph/i,
    /visualization/i,
    /analytics/i,
    /report/i,
    /don't.*manage/i,
    /no.*crud/i,
    /without.*edit/i,
  ]

  return negativePatterns.some((pattern) => pattern.test(prompt))
}

/**
 * Detect CRUD intent with context from previous messages
 */
export function detectCRUDIntentWithContext(
  prompt: string,
  conversationHistory: string[]
): CRUDIntentResult {
  // Combine recent conversation for context
  const context = conversationHistory.slice(-3).join(' ')
  const fullPrompt = `${context} ${prompt}`

  return detectCRUDIntent(fullPrompt)
}

/**
 * Get suggested CRUD operations based on detected intent
 */
export function getSuggestedCRUDOperations(
  result: CRUDIntentResult
): string[] {
  if (!result.detected) {
    return []
  }

  if (result.operation) {
    // If operation is 'manage', return full CRUD
    if (result.operation === 'manage') {
      return ['create', 'read', 'update', 'delete', 'list']
    }
    // Return specific operation
    return [result.operation]
  }

  // Default to full CRUD
  return ['create', 'read', 'update', 'delete', 'list']
}

/**
 * Batch detection for multiple prompts
 */
export function detectCRUDIntentBatch(
  prompts: string[]
): CRUDIntentResult[] {
  return prompts.map((prompt) => detectCRUDIntent(prompt))
}

/**
 * Get confidence explanation for debugging
 */
export function explainConfidence(result: CRUDIntentResult): string {
  const parts: string[] = []

  parts.push(`Detected: ${result.detected ? 'Yes' : 'No'}`)
  parts.push(`Confidence: ${(result.confidence * 100).toFixed(0)}%`)

  if (result.tableName) {
    parts.push(`Table: ${result.tableName}`)
  }

  if (result.operation) {
    parts.push(`Operation: ${result.operation}`)
  }

  if (result.reason) {
    parts.push(`Reason: ${result.reason}`)
  }

  return parts.join('\n')
}

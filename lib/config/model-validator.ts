/**
 * Model Configuration Validator
 * Validates AI model configuration on startup (Issue #5)
 * Updated: Uses Meta Llama (local) / AINative (cloud) — no Anthropic
 */

export interface ModelValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
  config: {
    primaryModel: string
    environment: 'local' | 'cloud'
    hasMetaKey: boolean
    hasAINativeToken: boolean
  }
}

const DEFAULT_MODEL = 'Llama-4-Maverick-17B-128E-Instruct-FP8'

export function validateModelConfiguration(): ModelValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  const isLocal = process.env.NODE_ENV === 'development' || process.env.USE_META_API === 'true'
  const metaKey = process.env.META_API_KEY
  const ainativeToken = process.env.AINATIVE_API_TOKEN || process.env.ZERODB_API_KEY
  const primaryModel = process.env.LLAMA_MODEL || DEFAULT_MODEL

  if (isLocal) {
    // Local development — need Meta API key
    if (!metaKey) {
      errors.push('META_API_KEY is not set. Local Llama generation will fail.')
    }
  } else {
    // Cloud/production — need AINative token
    if (!ainativeToken) {
      errors.push('ZERODB_API_KEY/AINATIVE_API_TOKEN is not set. Cloud generation will fail.')
    }
  }

  if (ainativeToken && metaKey) {
    // Both configured — good for flexibility
  } else if (!ainativeToken && !metaKey) {
    errors.push('No API keys configured. Set META_API_KEY (local) or ZERODB_API_KEY (cloud).')
  }

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    config: {
      primaryModel,
      environment: isLocal ? 'local' : 'cloud',
      hasMetaKey: !!metaKey,
      hasAINativeToken: !!ainativeToken,
    },
  }
}

export function logModelConfiguration(): void {
  const result = validateModelConfiguration()

  console.log('\n=== Model Configuration ===')
  console.log(`  Primary model: ${result.config.primaryModel}`)
  console.log(`  Environment: ${result.config.environment}`)
  console.log(`  Meta API key: ${result.config.hasMetaKey ? 'configured' : 'not set'}`)
  console.log(`  AINative token: ${result.config.hasAINativeToken ? 'configured' : 'not set'}`)

  if (result.errors.length > 0) {
    console.error('\n  ERRORS:')
    result.errors.forEach(e => console.error(`    - ${e}`))
  }

  if (result.warnings.length > 0) {
    console.warn('\n  WARNINGS:')
    result.warnings.forEach(w => console.warn(`    - ${w}`))
  }

  console.log('===========================\n')
}

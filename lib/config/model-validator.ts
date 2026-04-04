/**
 * Model Configuration Validator
 * Validates AI model configuration on startup (Issue #5)
 */

export interface ModelValidationResult {
  valid: boolean
  warnings: string[]
  errors: string[]
  config: {
    primaryModel: string
    hasAnthropicKey: boolean
    hasAINativeToken: boolean
    extendedThinkingEnabled: boolean
  }
}

const RECOMMENDED_MODEL = 'claude-sonnet-4-20250514'

export function validateModelConfiguration(): ModelValidationResult {
  const warnings: string[] = []
  const errors: string[] = []

  const anthropicKey = process.env.ANTHROPIC_API_KEY
  const anthropicModel = process.env.ANTHROPIC_MODEL || RECOMMENDED_MODEL
  const ainativeToken = process.env.AINATIVE_API_TOKEN || process.env.ZERODB_API_KEY

  // Check required API key
  if (!anthropicKey) {
    errors.push('ANTHROPIC_API_KEY is not set. Primary generation will fail.')
  } else if (!anthropicKey.startsWith('sk-ant-')) {
    warnings.push('ANTHROPIC_API_KEY does not start with sk-ant-. Verify it is a valid Anthropic key.')
  }

  // Check model configuration
  if (anthropicModel !== RECOMMENDED_MODEL) {
    warnings.push(
      `ANTHROPIC_MODEL is set to "${anthropicModel}" instead of recommended "${RECOMMENDED_MODEL}".`
    )
  }

  // Check AINative token for multi-model routing
  if (!ainativeToken) {
    warnings.push('AINATIVE_API_TOKEN/ZERODB_API_KEY not set. Non-Anthropic models will be unavailable.')
  }

  // Extended thinking check
  const extendedThinkingEnabled = true // Always enabled in chat-ws route

  return {
    valid: errors.length === 0,
    warnings,
    errors,
    config: {
      primaryModel: anthropicModel,
      hasAnthropicKey: !!anthropicKey,
      hasAINativeToken: !!ainativeToken,
      extendedThinkingEnabled,
    },
  }
}

export function logModelConfiguration(): void {
  const result = validateModelConfiguration()

  console.log('\n=== Model Configuration ===')
  console.log(`  Primary model: ${result.config.primaryModel}`)
  console.log(`  Anthropic API key: ${result.config.hasAnthropicKey ? 'configured' : 'MISSING'}`)
  console.log(`  AINative token: ${result.config.hasAINativeToken ? 'configured' : 'not set'}`)
  console.log(`  Extended thinking: ${result.config.extendedThinkingEnabled ? 'enabled' : 'disabled'}`)

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

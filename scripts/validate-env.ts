#!/usr/bin/env tsx

/**
 * Environment Variable Validation Script
 *
 * Validates that all required environment variables are set
 * and have valid values before deployment.
 *
 * Usage:
 *   tsx scripts/validate-env.ts
 *   NODE_ENV=production tsx scripts/validate-env.ts
 */

import * as dotenv from 'dotenv'
import { readFileSync } from 'fs'
import { join } from 'path'

// Load environment variables
dotenv.config()

interface ValidationResult {
  valid: boolean
  errors: string[]
  warnings: string[]
}

interface EnvVar {
  name: string
  required: boolean
  validate?: (value: string) => boolean | string
  description?: string
}

const ENV_VARIABLES: EnvVar[] = [
  // Core Application
  {
    name: 'NODE_ENV',
    required: true,
    validate: (v) => ['development', 'production', 'test'].includes(v) || 'Must be development, production, or test',
    description: 'Application environment',
  },
  {
    name: 'NEXT_PUBLIC_APP_URL',
    required: true,
    validate: (v) => v.startsWith('http://') || v.startsWith('https://') || 'Must be a valid URL',
    description: 'Public application URL',
  },

  // Authentication
  {
    name: 'AUTH_SECRET',
    required: true,
    validate: (v) => v.length >= 32 || 'Must be at least 32 characters',
    description: 'NextAuth.js secret for JWT signing',
  },

  // Database
  {
    name: 'POSTGRES_URL',
    required: true,
    validate: (v) => v.startsWith('postgres://') || v.startsWith('postgresql://') || 'Must be a valid PostgreSQL URL',
    description: 'PostgreSQL connection URL',
  },
  {
    name: 'DATABASE_URL',
    required: true,
    validate: (v) => v.startsWith('postgres://') || v.startsWith('postgresql://') || 'Must be a valid PostgreSQL URL',
    description: 'Alternative database URL',
  },

  // Redis
  {
    name: 'UPSTASH_REDIS_REST_URL',
    required: true,
    validate: (v) => v.startsWith('https://') || 'Must be a valid HTTPS URL',
    description: 'Upstash Redis REST URL for Edge Runtime',
  },
  {
    name: 'UPSTASH_REDIS_REST_TOKEN',
    required: true,
    validate: (v) => v.length > 0,
    description: 'Upstash Redis REST token',
  },
  {
    name: 'REDIS_URL',
    required: true,
    validate: (v) => v.startsWith('redis://') || v.startsWith('rediss://') || 'Must be a valid Redis URL',
    description: 'Standard Redis URL for Node.js runtime',
  },
  {
    name: 'REDIS_TTL',
    required: false,
    validate: (v) => !isNaN(parseInt(v)) || 'Must be a valid number',
    description: 'Redis TTL in seconds',
  },

  // AI Services
  {
    name: 'ANTHROPIC_API_KEY',
    required: true,
    validate: (v) => v.startsWith('sk-ant-') || 'Must be a valid Anthropic API key',
    description: 'Anthropic API key for Claude',
  },
  {
    name: 'ANTHROPIC_MODEL',
    required: false,
    description: 'Claude model to use',
  },
  {
    name: 'USE_SUBAGENTS',
    required: false,
    validate: (v) => ['true', 'false'].includes(v.toLowerCase()) || 'Must be true or false',
    description: 'Enable subagent architecture',
  },
  {
    name: 'META_API_KEY',
    required: true,
    description: 'Meta LLAMA API key',
  },
  {
    name: 'META_BASE_URL',
    required: false,
    validate: (v) => v.startsWith('https://') || 'Must be a valid HTTPS URL',
    description: 'Meta API base URL',
  },
  {
    name: 'LLAMA_MODEL',
    required: false,
    description: 'LLAMA model name',
  },
  {
    name: 'OPENAI_API_KEY',
    required: true,
    validate: (v) => v.startsWith('sk-') || 'Must be a valid OpenAI API key',
    description: 'OpenAI API key for embeddings',
  },

  // ZeroDB
  {
    name: 'ZERODB_MCP_URL',
    required: false,
    validate: (v) => v.startsWith('https://') || 'Must be a valid HTTPS URL',
    description: 'ZeroDB MCP server URL',
  },
  {
    name: 'ZERODB_MCP_API_KEY',
    required: true,
    description: 'ZeroDB API key',
  },
  {
    name: 'ZERODB_PROJECT_ID',
    required: true,
    description: 'ZeroDB project ID',
  },

  // Rate Limiting
  {
    name: 'MAX_CHATS_PER_HOUR',
    required: false,
    validate: (v) => !isNaN(parseInt(v)) && parseInt(v) > 0 || 'Must be a positive number',
    description: 'Maximum chats per user per hour',
  },
  {
    name: 'MAX_ANONYMOUS_CHATS_PER_HOUR',
    required: false,
    validate: (v) => !isNaN(parseInt(v)) && parseInt(v) > 0 || 'Must be a positive number',
    description: 'Maximum anonymous chats per IP per hour',
  },

  // Encryption
  {
    name: 'DEPLOYMENT_ENCRYPTION_KEY',
    required: true,
    validate: (v) => v.length === 64 || 'Must be 64 characters (32 bytes hex)',
    description: 'AES-256-GCM encryption key for deployment credentials',
  },

  // Monitoring
  {
    name: 'LOG_LEVEL',
    required: false,
    validate: (v) => ['debug', 'info', 'warn', 'error'].includes(v) || 'Must be debug, info, warn, or error',
    description: 'Logging level',
  },
  {
    name: 'SENTRY_DSN',
    required: false,
    validate: (v) => v.startsWith('https://') || 'Must be a valid HTTPS URL',
    description: 'Sentry DSN for error tracking',
  },

  // Optional
  {
    name: 'DEEPL_API_KEY',
    required: false,
    description: 'DeepL API key for translation',
  },
]

function validateEnvironment(): ValidationResult {
  const errors: string[] = []
  const warnings: string[] = []

  console.log('\n🔍 Validating environment variables...\n')

  // Check each variable
  ENV_VARIABLES.forEach((envVar) => {
    const value = process.env[envVar.name]

    if (!value || value.trim() === '') {
      if (envVar.required) {
        errors.push(`❌ ${envVar.name} is required but not set${envVar.description ? `: ${envVar.description}` : ''}`)
      } else {
        warnings.push(`⚠️  ${envVar.name} is not set (optional)${envVar.description ? `: ${envVar.description}` : ''}`)
      }
      return
    }

    // Validate value if validator is provided
    if (envVar.validate) {
      const result = envVar.validate(value)
      if (result !== true) {
        if (envVar.required) {
          errors.push(`❌ ${envVar.name}: ${typeof result === 'string' ? result : 'Invalid value'}`)
        } else {
          warnings.push(`⚠️  ${envVar.name}: ${typeof result === 'string' ? result : 'Invalid value'}`)
        }
      } else {
        console.log(`✅ ${envVar.name}`)
      }
    } else {
      console.log(`✅ ${envVar.name}`)
    }
  })

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  }
}

function main() {
  console.log('━'.repeat(60))
  console.log('🚀 Environment Variable Validation')
  console.log('━'.repeat(60))

  const result = validateEnvironment()

  console.log('\n' + '━'.repeat(60))

  if (result.warnings.length > 0) {
    console.log('\n⚠️  Warnings:\n')
    result.warnings.forEach((warning) => console.log(`  ${warning}`))
  }

  if (result.errors.length > 0) {
    console.log('\n❌ Errors:\n')
    result.errors.forEach((error) => console.log(`  ${error}`))
    console.log('\n' + '━'.repeat(60))
    console.log('\n❌ Validation failed! Please fix the errors above.\n')
    process.exit(1)
  }

  console.log('\n✅ All required environment variables are valid!\n')
  console.log('━'.repeat(60) + '\n')
  process.exit(0)
}

main()

#!/usr/bin/env tsx

/**
 * Claude model smoke-test CLI (issue #887)
 *
 * Makes a minimal real API call (max_tokens: 1) against whichever
 * Claude-family client Builder's chat-ws route would actually use in
 * production (Bedrock primary, direct Anthropic fallback — see
 * lib/config/claude-model-smoketest.ts), and exits non-zero with an
 * alert-worthy message if the call fails or the API responds with a
 * different model than requested.
 *
 * Usage:
 *   tsx scripts/verify-claude-model.ts
 *   npx tsx scripts/verify-claude-model.ts
 */

import * as dotenv from 'dotenv'
dotenv.config()

import { runClaudeModelSmokeTest } from '../lib/config/claude-model-smoketest'

async function main() {
  const result = await runClaudeModelSmokeTest()

  if (result.ok) {
    console.log('[verify-claude-model] OK')
    console.log(`  provider: ${result.provider}`)
    console.log(`  requested model: ${result.requestedModel}`)
    if (result.respondedModel) console.log(`  responded model: ${result.respondedModel}`)
    if (typeof result.latencyMs === 'number') console.log(`  latency: ${result.latencyMs}ms`)
    process.exit(0)
  }

  console.error('[verify-claude-model] FAILED — configured Claude model is not reachable/healthy')
  console.error(`  provider: ${result.provider}`)
  console.error(`  requested model: ${result.requestedModel}`)
  if (result.respondedModel) console.error(`  responded model: ${result.respondedModel}`)
  console.error(`  error: ${result.error}`)
  process.exit(1)
}

main().catch((e) => {
  console.error('[verify-claude-model] FAILED — unexpected error running smoke test')
  console.error(e)
  process.exit(1)
})

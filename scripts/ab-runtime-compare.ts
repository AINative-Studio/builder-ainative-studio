#!/usr/bin/env npx tsx
/**
 * A/B: compare generation across runtime configs through the REAL builder path
 * (runHeadlessAgent). Each config runs the same prompt in an isolated worktree;
 * we capture the resulting file map + timing.
 *
 * Usage:
 *   npx tsx scripts/ab-runtime-compare.ts <configKey> "<prompt>" <outDir>
 *
 * configKey:
 *   cody-kimi     — AGENT_RUNTIME=cody (live path; ANTHROPIC_MODEL remapped to kimi-k2)
 *   claude-sonnet — AGENT_RUNTIME=claude + Bedrock + Sonnet 4.6
 *   cody-sonnet   — AGENT_RUNTIME=cody + Bedrock + Sonnet 4.6 (keeps cody harness)
 *
 * Env (Bedrock) must already be exported by the caller for the *-sonnet configs.
 */
import { createWorktree, cleanupWorktree, getWorktreeFiles } from '../lib/agent/worktree-manager'
import { runHeadlessAgent, type AgentEvent } from '../lib/agent/claude-agent'
import { writeFileSync, mkdirSync } from 'fs'
import { join } from 'path'

const [, , configKey, prompt, outDir] = process.argv
if (!configKey || !prompt || !outDir) {
  console.error('usage: ab-runtime-compare.ts <configKey> "<prompt>" <outDir>')
  process.exit(1)
}
mkdirSync(outDir, { recursive: true })

const chatId = `ab-${configKey}-${Date.now()}`

async function main() {
  const t0 = Date.now()
  await createWorktree(chatId)
  const events: string[] = []
  let errored: string | null = null
  try {
    for await (const ev of runHeadlessAgent(prompt, chatId, { maxBudgetUsd: 1.0, model: process.env.AB_MODEL || 'sonnet' })) {
      const e = ev as AgentEvent
      events.push(`${e.type}${(e as any).step ? ': ' + (e as any).step : ''}${(e as any).error ? ': ' + (e as any).error : ''}`)
      if (e.type === 'error') errored = (e as any).error
    }
  } catch (err) {
    errored = err instanceof Error ? err.message : String(err)
  }
  const elapsed = Date.now() - t0
  let files: Record<string, string> = {}
  try { files = await getWorktreeFiles(chatId) } catch { /* worktree may be empty */ }

  const totalChars = Object.values(files).reduce((s, c) => s + c.length, 0)
  const summary = {
    configKey,
    runtime: process.env.AGENT_RUNTIME,
    model: process.env.AB_MODEL || 'sonnet',
    useBedrock: process.env.CLAUDE_CODE_USE_BEDROCK || 'false',
    elapsedMs: elapsed,
    errored,
    fileCount: Object.keys(files).length,
    files: Object.keys(files),
    totalChars,
  }
  writeFileSync(join(outDir, `${configKey}.summary.json`), JSON.stringify(summary, null, 2))
  writeFileSync(join(outDir, `${configKey}.files.json`), JSON.stringify(files, null, 2))
  writeFileSync(join(outDir, `${configKey}.events.txt`), events.join('\n'))
  console.log(JSON.stringify(summary, null, 2))
  await cleanupWorktree(chatId)
}
main().catch((e) => { console.error(e); process.exit(1) })

#!/usr/bin/env npx tsx
/**
 * Test script for the headless Claude Code agent (Phase 0).
 *
 * Usage:
 *   USE_CLAUDE_AGENT=true npx tsx scripts/test-agent.ts
 *
 * Requires:
 *   - ANTHROPIC_API_KEY set in the environment (or claude CLI logged in)
 *   - `claude` CLI installed globally (npm i -g @anthropic-ai/claude-code)
 *   - USE_CLAUDE_AGENT=true
 *
 * What it does:
 *   1. Creates an isolated worktree for a test session
 *   2. Runs the headless agent with a counter-app prompt
 *   3. Prints each agent event as it arrives
 *   4. Shows the final file map
 *   5. Cleans up the worktree
 */

import {
  createWorktree,
  cleanupWorktree,
  getWorktreeFiles,
  getWorktreePath,
} from '../lib/agent/worktree-manager'
import { runHeadlessAgent, type AgentEvent } from '../lib/agent/claude-agent'

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const TEST_CHAT_ID = `test-agent-${Date.now()}`
const TEST_PROMPT = `Build a simple counter app with increment and decrement buttons.

Requirements:
- A centered card with a current count display
- An increment (+) button and a decrement (-) button
- Use Tailwind CSS for styling
- Use React useState for state management
- The count should be displayed in a large font
- Buttons should have hover effects
- Write the component in src/App.tsx`

const AGENT_OPTIONS = {
  maxBudgetUsd: 0.50,
  model: 'sonnet',
}

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function formatEvent(event: AgentEvent): string {
  const ts = new Date().toISOString().slice(11, 23)

  switch (event.type) {
    case 'build_step':
      return `[${ts}] STEP    ${event.step}`
    case 'chunk':
      // Truncate long chunks for readability
      const preview = event.content.length > 200
        ? event.content.slice(0, 200) + '...'
        : event.content
      return `[${ts}] CHUNK   ${preview.replace(/\n/g, '\\n')}`
    case 'chunk_progress':
      return `[${ts}] PROGRESS  Turn ${event.phase}/${event.totalPhases}`
    case 'files':
      const count = Object.keys(event.files).length
      return `[${ts}] FILES   ${count} file(s) collected`
    case 'complete':
      return `[${ts}] DONE    chatId=${event.chatId} duration=${event.durationMs}ms`
    case 'error':
      return `[${ts}] ERROR   ${event.fatal ? '[FATAL] ' : ''}${event.error}`
    default:
      return `[${ts}] ???     ${JSON.stringify(event)}`
  }
}

function printSeparator(label: string): void {
  const line = '='.repeat(60)
  console.log(`\n${line}`)
  console.log(`  ${label}`)
  console.log(`${line}\n`)
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log('Headless Claude Code Agent - Phase 0 Test')
  console.log(`Chat ID: ${TEST_CHAT_ID}`)
  console.log(`Prompt:  "${TEST_PROMPT.split('\n')[0]}..."`)
  console.log()

  // Check environment
  if (process.env.USE_CLAUDE_AGENT !== 'true') {
    console.error('ERROR: USE_CLAUDE_AGENT is not set to "true".')
    console.error('Run with: USE_CLAUDE_AGENT=true npx tsx scripts/test-agent.ts')
    process.exit(1)
  }

  // -----------------------------------------------------------------------
  // Step 1: Create worktree
  // -----------------------------------------------------------------------
  printSeparator('Step 1: Creating worktree')

  const worktreePath = await createWorktree(TEST_CHAT_ID)
  console.log(`Worktree created at: ${worktreePath}`)

  const scaffoldFiles = await getWorktreeFiles(TEST_CHAT_ID)
  console.log(`Scaffold files: ${Object.keys(scaffoldFiles).join(', ')}`)

  // -----------------------------------------------------------------------
  // Step 2: Run the agent
  // -----------------------------------------------------------------------
  printSeparator('Step 2: Running headless agent')

  let finalFiles: Record<string, string> = {}
  let hadError = false

  try {
    for await (const event of runHeadlessAgent(TEST_PROMPT, TEST_CHAT_ID, AGENT_OPTIONS)) {
      console.log(formatEvent(event))

      if (event.type === 'files') {
        finalFiles = event.files
      }
      if (event.type === 'error' && event.fatal) {
        hadError = true
      }
    }
  } catch (err) {
    console.error('Unhandled error during agent run:', err)
    hadError = true
  }

  // -----------------------------------------------------------------------
  // Step 3: Show final files
  // -----------------------------------------------------------------------
  printSeparator('Step 3: Final file map')

  if (Object.keys(finalFiles).length === 0) {
    // Try reading directly from the worktree
    finalFiles = await getWorktreeFiles(TEST_CHAT_ID)
  }

  if (Object.keys(finalFiles).length === 0) {
    console.log('No files found in worktree.')
  } else {
    for (const [path, content] of Object.entries(finalFiles).sort()) {
      const lines = content.split('\n').length
      const bytes = Buffer.byteLength(content, 'utf-8')
      console.log(`  ${path} (${lines} lines, ${bytes} bytes)`)
    }

    // Print the App.tsx content if it exists
    const appFile =
      finalFiles['src/App.tsx'] ||
      finalFiles['App.tsx'] ||
      Object.values(finalFiles).find((v) => v.includes('useState'))

    if (appFile) {
      printSeparator('src/App.tsx content')
      console.log(appFile)
    }
  }

  // -----------------------------------------------------------------------
  // Step 4: Cleanup
  // -----------------------------------------------------------------------
  printSeparator('Step 4: Cleanup')

  await cleanupWorktree(TEST_CHAT_ID)
  console.log(`Worktree cleaned up: ${worktreePath}`)

  // -----------------------------------------------------------------------
  // Summary
  // -----------------------------------------------------------------------
  printSeparator('Summary')
  console.log(`Status:     ${hadError ? 'FAILED' : 'SUCCESS'}`)
  console.log(`Files:      ${Object.keys(finalFiles).length}`)
  console.log(`Chat ID:    ${TEST_CHAT_ID}`)
  console.log(`Worktree:   ${getWorktreePath(TEST_CHAT_ID)} (cleaned up)`)

  process.exit(hadError ? 1 : 0)
}

main().catch((err) => {
  console.error('Fatal error:', err)
  // Attempt cleanup on crash
  cleanupWorktree(TEST_CHAT_ID).catch(() => {})
  process.exit(1)
})

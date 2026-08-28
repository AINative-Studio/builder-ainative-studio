/**
 * Headless Claude Code Agent — Phase 0 Implementation
 *
 * Spawns the Claude Code CLI (`claude`) as a child process in `--print` mode
 * with `--output-format stream-json`, pointed at a per-session worktree.
 *
 * The agent operates on the worktree filesystem with full tool access
 * (Read, Write, Edit, Bash, Glob, Grep) under `--permission-mode acceptEdits`.
 *
 * Yields AgentEvent objects that map directly onto the existing SSE envelope
 * consumed by the frontend (build_step, chunk, files, complete, error).
 *
 * Gated behind process.env.USE_CLAUDE_AGENT === 'true'.
 */

import { spawn, type ChildProcess } from 'child_process'
import { cp, rm } from 'fs/promises'
import { TrajectoryCapture } from './trajectory-capture'
import { storeTrajectory } from './trajectory-store'
import { mcpDataProvisioningBlock } from '@/lib/build/primitive-catalog'
import { createWorktree, getWorktreeFiles, getWorktreePath } from './worktree-manager'
import {
  buildTestGenerationInstructions,
  buildTestFailureError,
  findGeneratedTestFile,
  isWorktreeTestGateEnabled,
  recordWorktreeTestResult,
  runWorktreeTests,
  stripTestFiles,
} from './test-runner'
import {
  getAgentBinary,
  getAgentRuntime,
  getAgentSpawnEnv,
  isAgentEnabled,
  isAgentFallbackEnabled,
  resolveAgentModel,
  buildAgentMcpWiring,
} from './agent-runtime'
import { planReviewPromptBlock, PLAN_REVIEW_TURN_HEADROOM } from './plan-review'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Events yielded by the headless agent, matching the SSE envelope. */
export type AgentEvent =
  | { type: 'build_step'; step: string }
  | { type: 'chunk'; content: string }
  | { type: 'chunk_progress'; phase: number; totalPhases: number }
  | { type: 'files'; files: Record<string, string> }
  | { type: 'complete'; chatId: string; durationMs: number; tokenUsage?: AgentTokenUsage }
  | { type: 'error'; error: string; fatal?: boolean }

export interface AgentTokenUsage {
  inputTokens: number
  outputTokens: number
  cacheCreationTokens: number
  cacheReadTokens: number
  totalCostUsd: number
}

export interface AgentOptions {
  /** Maximum turns the agent can take. Maps to --max-budget-usd as a proxy. */
  maxTurns?: number
  /** Claude model to use (e.g. 'sonnet', 'opus', 'claude-sonnet-4-5'). */
  model?: string
  /** Maximum USD budget for this agent run. Default: $1.00. */
  maxBudgetUsd?: number
  /** Additional system prompt to append. */
  systemPrompt?: string
  /** Allowed tools. Defaults to the standard safe set. */
  allowedTools?: string[]
  /** Abort signal to cancel the agent. */
  abortSignal?: AbortSignal
  /**
   * Run the worktree vitest gate on the generated test file after the agent
   * finishes (#341). Defaults to true; verify/repair runs set false so a fix
   * pass never re-enters the gate.
   */
  runGeneratedTests?: boolean
  /**
   * Plan + bounded self-review discipline (#342). Default true for build runs:
   * the agent maintains .cody-plan.md and does ONE review pass before finish.
   * Set false for short repair-style runs (verify-loop) where a plan file and
   * review turn would waste the tight turn budget.
   */
  planReview?: boolean
}

/** Raw event from Claude Code's stream-json output. */
interface ClaudeStreamEvent {
  type: string
  subtype?: string
  // For assistant messages
  message?: {
    role?: string
    content?: Array<{
      type: string
      text?: string
      name?: string
      input?: Record<string, unknown>
    }>
  }
  // For result events
  result?: string
  is_error?: boolean
  duration_ms?: number
  num_turns?: number
  total_cost_usd?: number
  usage?: {
    input_tokens?: number
    output_tokens?: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  // For tool use content blocks
  tool_name?: string
  tool_input?: Record<string, unknown>
  // Content block fields (when type is "content_block_start" etc.)
  content_block?: {
    type: string
    text?: string
    name?: string
    input?: Record<string, unknown>
  }
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Write/Edit to build; Read so the single self-review pass (#342) can re-read
// the files it wrote. Still no Bash/Glob/Grep — no shell, no exploring.
const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit']
const DEFAULT_MAX_BUDGET_USD = 1.0
const DEFAULT_MODEL = 'sonnet'
const AGENT_SYSTEM_PROMPT = `You are building a React component in an isolated workspace.

WORKSPACE STRUCTURE (already exists, do NOT explore — just write code):
  src/App.tsx — EDIT THIS FILE with your component (default export)
  src/App.test.tsx — EDIT THIS FILE with vitest tests for the app (see TESTS below)
  src/main.tsx — entry point (do not modify)
  src/index.css — Tailwind imports (do not modify)
  package.json — has react, tailwind, lucide-react, recharts (do not modify)

RULES:
- IMMEDIATELY edit src/App.tsx with your full component code — do NOT explore first
- Use "export default function App()" as the component
- Use Tailwind CSS classes for all styling
- Use lucide-react for icons: import { IconName } from 'lucide-react'
- Use recharts for charts: import { LineChart, BarChart, ... } from 'recharts'
- DO NOT run npm install, npm run build, or any shell commands
- DO NOT run ls, cat, or explore the filesystem — the structure is above
- DO NOT create new files — all app code goes in src/App.tsx, all tests in the existing src/App.test.tsx
- Make it visually polished with realistic sample data
- Ensure all JSX tags are properly closed
- For content strings with apostrophes (contractions like "it's", "you're"), use double quotes or escape the apostrophe (\\') so they don't end the string early and break the syntax

${buildTestGenerationInstructions()}`

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the headless Claude agent is enabled.
 */
export function isClaudeAgentEnabled(): boolean {
  // Delegates to the runtime resolver — true for USE_CLAUDE_AGENT=true or the
  // cody runtime (#79).
  return isAgentEnabled()
}

/**
 * Returns true if the agent fallback (for validation failures) is enabled.
 * Enabled by USE_CLAUDE_AGENT_FALLBACK, USE_CLAUDE_AGENT, or the cody runtime.
 */
export function isClaudeAgentFallbackEnabled(): boolean {
  return isAgentFallbackEnabled()
}

// ---------------------------------------------------------------------------
// Main entry point
// ---------------------------------------------------------------------------

/**
 * Runs the headless Claude Code agent against a per-session worktree.
 *
 * @param prompt - The user's prompt / build instructions.
 * @param chatId - Unique session identifier (used for worktree isolation).
 * @param options - Optional configuration (model, budget, tools, etc.).
 * @yields AgentEvent objects matching the SSE envelope format.
 */
export async function* runHeadlessAgent(
  prompt: string,
  chatId: string,
  options: AgentOptions = {},
): AsyncGenerator<AgentEvent> {
  if (!isAgentEnabled()) {
    yield {
      type: 'error',
      error: 'Agent runtime is not enabled. Set USE_CLAUDE_AGENT=true or AGENT_RUNTIME=cody.',
      fatal: true,
    }
    return
  }

  const startTime = Date.now()

  // 1. Create the worktree
  let worktreePath: string
  try {
    worktreePath = await createWorktree(chatId)
    yield { type: 'build_step', step: 'Workspace initialized' }
  } catch (err) {
    yield {
      type: 'error',
      error: `Failed to create worktree: ${err instanceof Error ? err.message : String(err)}`,
      fatal: true,
    }
    return
  }

  // 2. Build CLI arguments
  const {
    model: requestedModel = DEFAULT_MODEL,
    maxBudgetUsd = DEFAULT_MAX_BUDGET_USD,
    systemPrompt,
    allowedTools = DEFAULT_ALLOWED_TOOLS,
    abortSignal,
  } = options

  // Map the model to one the active runtime can actually serve. For cody this
  // rewrites Anthropic shorthands (sonnet/opus) — which the AINative tier 403s
  // on, causing a fallback and lost capture — to an AINative coding model.
  // Refs builder#99.
  const model = resolveAgentModel(requestedModel)

  // A real codegen task is read → write → verify → fix, not 1-2 turns. With
  // maxTurns=3 the run hit --max-turns mid-tool-call and cody returned an empty
  // error result (cody-cli#251 / builder#99). 12 gives room for a full
  // read→edit→verify→retry loop; cody stops early on its own when done.
  // #342: plan + bounded review discipline (default ON; repair runs opt out).
  const planReview = options.planReview !== false
  // #342: add fixed headroom for the plan turn (.cody-plan.md) + the ONE
  // self-review pass, so they never eat the budget meant for building.
  const maxTurns = (options.maxTurns || 12) + (planReview ? PLAN_REVIEW_TURN_HEADROOM : 0)

  // MCP tool wiring (#296 item 3, finally activated): give the agent the
  // AINative primitive MCP fleet (ZeroDB 69-tool surface, ZeroMemory,
  // ZeroVoice, OpenCapStack, Strapi) so Cody can OPERATE primitives during a
  // build, not just generate code that talks about them. Server-level
  // mcp__<name> entries extend allowedTools; inert when no key / CODY_AGENT_MCP=0.
  const mcp = buildAgentMcpWiring()
  const effectiveTools = [...allowedTools, ...mcp.allowedTools]

  const args: string[] = [
    '--print',
    prompt,
    '--output-format', 'stream-json',
    '--verbose',  // Required for stream-json output format
    '--permission-mode', 'acceptEdits',
    '--model', model,
    '--max-turns', String(maxTurns),
    '--max-budget-usd', String(maxBudgetUsd),
    '--bare',
    // #343 trajectory fix: cody only emits a complete `assistant` event when a
    // message FINISHES. A run killed mid-turn (budget / max-turns / abort)
    // therefore produced ZERO assistant events, and every such prod trajectory
    // landed with steps:[] even though the agent was mid-tool-call. Partial
    // events ({type:'stream_event', event:{content_block_start|delta|...}})
    // let TrajectoryCapture reconstruct the in-flight turn. translateEvent
    // intentionally IGNORES stream_event so SSE output is not double-emitted.
    '--include-partial-messages',
    '--allowedTools', ...effectiveTools,
  ]
  if (mcp.configJson) args.push('--mcp-config', mcp.configJson)

  // Compose the agent system prompt: workspace rules + plan/review discipline
  // (#342) + — only when the ZeroDB MCP server is actually wired — the real-
  // data provisioning paragraph (#343). Only when wired: instructing a
  // tool-less run to call MCP makes it hallucinate.
  const mcpBlock = mcp.configJson ? '\n\n' + mcpDataProvisioningBlock() : ''
  const fullSystemPrompt =
    AGENT_SYSTEM_PROMPT +
    (planReview ? '\n\n' + planReviewPromptBlock() : '') +
    mcpBlock +
    (systemPrompt ? '\n\n' + systemPrompt : '')
  args.push('--append-system-prompt', fullSystemPrompt)

  // 3. Spawn the agent process — binary + env resolved by AGENT_RUNTIME (#79).
  //    Both `claude` and `cody` speak the same stream-json protocol; `cody`
  //    (AINative's own harness) points at api.ainative.studio and has no
  //    external Anthropic dependency.
  const agentBinary = getAgentBinary()
  const runtime = getAgentRuntime()
  yield { type: 'build_step', step: `Starting ${runtime} agent (model: ${model})` }

  let child: ChildProcess
  try {
    child = spawn(agentBinary, args, {
      cwd: worktreePath,
      env: {
        ...process.env,
        ...getAgentSpawnEnv(),
      },
      stdio: ['ignore', 'pipe', 'pipe'],  // Close stdin immediately (no interactive input)
    })
  } catch (err) {
    yield {
      type: 'error',
      error: `Failed to spawn ${agentBinary} CLI: ${err instanceof Error ? err.message : String(err)}`,
      fatal: true,
    }
    return
  }

  // Handle abort signal
  if (abortSignal) {
    const onAbort = () => {
      child.kill('SIGTERM')
    }
    abortSignal.addEventListener('abort', onAbort, { once: true })
    child.on('exit', () => abortSignal.removeEventListener('abort', onAbort))
  }

  // 4. Process the NDJSON stream
  let turnCount = 0
  let lastError: string | null = null
  let buffer = ''

  // Fine-tuning trajectory capture (opt-in via CAPTURE_TRAJECTORIES=true).
  // Taps the raw event stream; finalized + auto-verified after the run.
  const captureEnabled = process.env.CAPTURE_TRAJECTORIES === 'true'
  const trajectory = captureEnabled
    ? new TrajectoryCapture(chatId, prompt, model)
    : null

  const processLine = function* (line: string): Generator<AgentEvent> {
    const trimmed = line.trim()
    if (!trimmed) return

    let event: ClaudeStreamEvent
    try {
      event = JSON.parse(trimmed)
    } catch {
      // Not valid JSON — skip
      return
    }

    // Tap the raw event for fine-tuning trajectory capture (no-op if disabled).
    trajectory?.observe(event)

    // Map Claude Code stream events to our SSE envelope
    yield* translateEvent(event)
  }

  const translateEvent = function* (event: ClaudeStreamEvent): Generator<AgentEvent> {
    switch (event.type) {
      case 'assistant': {
        // Assistant message — extract text content and tool uses
        if (event.message?.content) {
          for (const block of event.message.content) {
            if (block.type === 'text' && block.text) {
              yield { type: 'chunk', content: block.text }
            }
            if (block.type === 'tool_use' && block.name) {
              yield* translateToolUse(block.name, block.input || {})
            }
          }
        }
        turnCount++
        yield {
          type: 'chunk_progress',
          phase: turnCount,
          // We do not know total phases in advance; use maxTurns as estimate
          totalPhases: options.maxTurns || 10,
        }
        break
      }

      case 'content_block_start':
      case 'content_block_delta': {
        // Streaming content blocks
        const block = event.content_block
        if (block?.type === 'text' && block.text) {
          yield { type: 'chunk', content: block.text }
        }
        if (block?.type === 'tool_use' && block.name) {
          yield* translateToolUse(block.name, block.input || {})
        }
        break
      }

      case 'result': {
        // Final result event — log full details for debugging
        const ev = event as any
        console.log(`[Agent] Result: is_error=${ev.is_error}, duration=${ev.duration_ms}ms, turns=${ev.num_turns}, cost=$${ev.total_cost_usd}, reason=${ev.terminal_reason || ev.stop_reason}`)
        if (ev.result) console.log(`[Agent] Result text: ${String(ev.result).slice(0, 300)}`)
        if (event.is_error) {
          lastError = event.result || 'Agent returned an error'
          yield { type: 'error', error: lastError, fatal: false }
        }
        break
      }

      default:
        // Other event types (system, user, etc.) — no action needed
        break
    }
  }

  const translateToolUse = function* (
    toolName: string,
    input: Record<string, unknown>,
  ): Generator<AgentEvent> {
    switch (toolName) {
      case 'Write':
      case 'FileWrite':
        yield {
          type: 'build_step',
          step: `Writing ${(input.file_path as string) || (input.path as string) || 'file'}`,
        }
        break
      case 'Edit':
      case 'FileEdit':
        yield {
          type: 'build_step',
          step: `Editing ${(input.file_path as string) || (input.path as string) || 'file'}`,
        }
        break
      case 'Read':
      case 'FileRead':
        yield {
          type: 'build_step',
          step: `Reading ${(input.file_path as string) || (input.path as string) || 'file'}`,
        }
        break
      case 'Bash':
        yield {
          type: 'build_step',
          step: `Running: ${truncate(String(input.command || ''), 80)}`,
        }
        break
      case 'Glob':
        yield { type: 'build_step', step: `Searching files: ${input.pattern || '...'}` }
        break
      case 'Grep':
        yield { type: 'build_step', step: `Searching content: ${input.pattern || '...'}` }
        break
      default:
        yield { type: 'build_step', step: `Tool: ${toolName}` }
    }
  }

  // Stream stdout line by line
  try {
    for await (const chunk of readStream(child.stdout!)) {
      buffer += chunk
      const lines = buffer.split('\n')
      // Keep the last (possibly incomplete) line in the buffer
      buffer = lines.pop() || ''

      for (const line of lines) {
        yield* processLine(line)
      }
    }

    // Process any remaining buffer
    if (buffer.trim()) {
      yield* processLine(buffer)
    }
  } catch (err) {
    if (abortSignal?.aborted) {
      yield { type: 'error', error: 'Agent run was cancelled', fatal: true }
      return
    }
    yield {
      type: 'error',
      error: `Stream error: ${err instanceof Error ? err.message : String(err)}`,
      fatal: true,
    }
    return
  }

  // Collect stderr for diagnostics
  let stderr = ''
  try {
    for await (const chunk of readStream(child.stderr!)) {
      stderr += chunk
    }
  } catch {
    // Ignore stderr read errors
  }

  // 5. Wait for process exit
  const exitCode = await new Promise<number | null>((resolve) => {
    if (child.exitCode !== null) {
      resolve(child.exitCode)
    } else {
      child.on('exit', (code) => resolve(code))
    }
  })

  const durationMs = Date.now() - startTime

  // Finalize + auto-verify + persist the trajectory for fine-tuning. Runs
  // regardless of exit code (failed runs are valuable negative-reward signal).
  // The npm install/build in autoVerify is slow, so we do NOT block the
  // generator on it — but the caller (chat-ws) deletes the worktree as soon as
  // this generator returns, so the backgrounded verify raced the cleanup and
  // EVERY prod reward failed with "ENOENT: uv_cwd" / "shell-init: error
  // retrieving current directory" (#343). Fix: take a cheap snapshot copy of
  // the worktree NOW (awaited — small scaffold, milliseconds), then run the
  // slow verify against the snapshot in the background and clean it up after.
  if (trajectory) {
    const snapshotPath = `${worktreePath}-trajsnap`
    let snapshotOk = false
    try {
      await cp(worktreePath, snapshotPath, {
        recursive: true,
        force: true,
        filter: (src) => !src.includes('node_modules') && !src.includes('/.git'),
      })
      snapshotOk = true
    } catch (err) {
      console.warn('[Trajectory] worktree snapshot failed:', err)
    }
    void trajectory
      .finalize(snapshotOk ? snapshotPath : worktreePath, startTime)
      .then((record) => storeTrajectory(record))
      .catch((err) => console.warn('[Trajectory] capture failed:', err))
      .finally(() => {
        if (snapshotOk) void rm(snapshotPath, { recursive: true, force: true }).catch(() => {})
      })
  }

  if (exitCode !== 0 && !abortSignal?.aborted) {
    const errorMsg = lastError || stderr.trim() || `Agent exited with code ${exitCode}`
    yield { type: 'error', error: errorMsg, fatal: true }
    return
  }

  // 6. Read final files from the worktree
  yield { type: 'build_step', step: 'Collecting output files' }
  let collectedFiles: Record<string, string> = {}
  try {
    collectedFiles = await getWorktreeFiles(chatId)
    if (Object.keys(collectedFiles).length > 0) {
      // Test files are internal verification artifacts (#341) — strip them
      // from the pipeline files map so a single-file app + its test doesn't
      // get routed as a multi-file app or persisted into the preview.
      const appFiles = stripTestFiles(collectedFiles)
      if (Object.keys(appFiles).length > 0) {
        yield { type: 'files', files: appFiles }
      }
    }
  } catch (err) {
    yield {
      type: 'error',
      error: `Failed to read worktree files: ${err instanceof Error ? err.message : String(err)}`,
      fatal: false,
    }
  }

  // 6b. TDD GATE (#341): run the generated vitest file in the worktree before
  // the app can be marked ready. Bounded: one test file, 60s hard timeout,
  // fail-open on every infra error — only a genuinely failing test records a
  // blockable outcome. chat-ws feeds a FAIL to the verify-loop repair agent;
  // ready-gate 422s register-app if the failure is never repaired.
  if (options.runGeneratedTests !== false && isWorktreeTestGateEnabled()) {
    const testFile = findGeneratedTestFile(Object.keys(collectedFiles))
    if (!testFile) {
      console.log('[TestGate] no generated test file found — skipping (fail-open)')
    } else {
      yield { type: 'build_step', step: `Running generated tests (${testFile})` }
      try {
        const outcome = await runWorktreeTests(worktreePath, testFile)
        recordWorktreeTestResult(chatId, outcome)
        console.log(`[TestGate] ${outcome.status} in ${outcome.durationMs}ms: ${outcome.summary.slice(0, 200)}`)
        if (outcome.status === 'pass') {
          yield { type: 'build_step', step: `Generated tests passed (${outcome.durationMs}ms)` }
        } else if (outcome.status === 'fail') {
          yield { type: 'build_step', step: 'Generated tests FAILED — queuing repair' }
          yield { type: 'error', error: buildTestFailureError(outcome.summary), fatal: false }
        } else {
          // skipped / infra_error — never block on tooling.
          yield { type: 'build_step', step: `Test runner unavailable (${outcome.status}) — continuing` }
        }
      } catch (err) {
        // Runner threw unexpectedly — infra, fail-open.
        console.warn('[TestGate] runner threw (fail-open):', err instanceof Error ? err.message : err)
      }
    }
  }

  // 7. Signal completion
  yield {
    type: 'complete',
    chatId,
    durationMs,
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Converts a Node.js readable stream into an async iterable of string chunks.
 */
async function* readStream(
  stream: NodeJS.ReadableStream,
): AsyncGenerator<string> {
  stream.setEncoding?.('utf-8')
  for await (const chunk of stream as AsyncIterable<string | Buffer>) {
    yield typeof chunk === 'string' ? chunk : chunk.toString('utf-8')
  }
}

/**
 * Truncates a string to maxLen characters, appending ellipsis if truncated.
 */
function truncate(s: string, maxLen: number): string {
  if (s.length <= maxLen) return s
  return s.slice(0, maxLen - 3) + '...'
}

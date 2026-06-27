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
import { createWorktree, getWorktreeFiles, getWorktreePath } from './worktree-manager'

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

const DEFAULT_ALLOWED_TOOLS = ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep']
const DEFAULT_MAX_BUDGET_USD = 1.0
const DEFAULT_MODEL = 'sonnet'
const AGENT_SYSTEM_PROMPT = `You are building a React component in an isolated workspace.
RULES:
- Write code to src/App.tsx (main component, default export)
- Use Tailwind CSS for styling
- Use lucide-react for icons
- Use recharts for charts
- DO NOT run npm install or npm run build — dependencies are pre-installed
- DO NOT create package.json or modify existing config files
- Focus on writing clean, complete React/TypeScript code
- Make the component visually polished and production-ready
- Use realistic sample data (not lorem ipsum)
- Ensure all JSX tags are properly closed`

// ---------------------------------------------------------------------------
// Guard
// ---------------------------------------------------------------------------

/**
 * Returns true if the headless Claude agent is enabled.
 */
export function isClaudeAgentEnabled(): boolean {
  return process.env.USE_CLAUDE_AGENT === 'true'
}

/**
 * Returns true if the Claude agent fallback (for validation failures) is enabled.
 * Enabled when either USE_CLAUDE_AGENT_FALLBACK=true or USE_CLAUDE_AGENT=true.
 */
export function isClaudeAgentFallbackEnabled(): boolean {
  return (
    process.env.USE_CLAUDE_AGENT_FALLBACK === 'true' ||
    process.env.USE_CLAUDE_AGENT === 'true'
  )
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
  if (!isClaudeAgentEnabled()) {
    yield {
      type: 'error',
      error: 'Claude agent is not enabled. Set USE_CLAUDE_AGENT=true.',
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
    model = DEFAULT_MODEL,
    maxBudgetUsd = DEFAULT_MAX_BUDGET_USD,
    systemPrompt,
    allowedTools = DEFAULT_ALLOWED_TOOLS,
    abortSignal,
  } = options

  const maxTurns = options.maxTurns || 5

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
    '--allowedTools', ...allowedTools,
  ]

  // Always inject the agent system prompt (workspace rules)
  const fullSystemPrompt = AGENT_SYSTEM_PROMPT + (systemPrompt ? '\n\n' + systemPrompt : '')
  args.push('--append-system-prompt', fullSystemPrompt)

  // 3. Spawn the claude process
  yield { type: 'build_step', step: `Starting Claude agent (model: ${model})` }

  let child: ChildProcess
  try {
    child = spawn('claude', args, {
      cwd: worktreePath,
      env: {
        ...process.env,
        // Ensure the agent uses the project's ANTHROPIC_API_KEY
        // ANTHROPIC_BASE_URL is respected automatically by the CLI
      },
      stdio: ['ignore', 'pipe', 'pipe'],  // Close stdin immediately (no interactive input)
    })
  } catch (err) {
    yield {
      type: 'error',
      error: `Failed to spawn claude CLI: ${err instanceof Error ? err.message : String(err)}`,
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

  if (exitCode !== 0 && !abortSignal?.aborted) {
    const errorMsg = lastError || stderr.trim() || `Agent exited with code ${exitCode}`
    yield { type: 'error', error: errorMsg, fatal: true }
    return
  }

  // 6. Read final files from the worktree
  yield { type: 'build_step', step: 'Collecting output files' }
  try {
    const files = await getWorktreeFiles(chatId)
    if (Object.keys(files).length > 0) {
      yield { type: 'files', files }
    }
  } catch (err) {
    yield {
      type: 'error',
      error: `Failed to read worktree files: ${err instanceof Error ? err.message : String(err)}`,
      fatal: false,
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

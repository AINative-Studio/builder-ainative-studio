/**
 * Cody trajectory capture for fine-tuning data.
 *
 * An agent's training signal is not `prompt -> final code`; it's the full
 * TRAJECTORY: task -> [assistant reasoning, tool_use, tool_result, ...] ->
 * final file tree -> an OBJECTIVE reward (does it install/build/run?).
 *
 * This module taps the raw stream-json events already flowing through
 * runHeadlessAgent(), accumulates the trajectory, then on completion runs
 * auto-verification against the worktree and persists a labeled record to
 * ZeroDB (table: cody_trajectories). No user feedback required — the reward is
 * execution-based (RLVR-style).
 */
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as path from 'path'

export interface TrajectoryStep {
  turn: number
  role: 'assistant' | 'tool_result'
  text?: string
  tool?: string
  toolInput?: unknown
  toolResult?: string
}

export interface VerifyResult {
  installed: boolean | null
  built: boolean | null
  ran: boolean | null
  httpOk: boolean | null
  /** Overall objective reward: 1 if the app demonstrably works, else 0. */
  reward: 0 | 1
  detail: string
}

export interface TrajectoryRecord {
  chat_id: string
  task: string
  model: string
  steps: TrajectoryStep[]
  file_tree: string[]
  num_turns: number
  total_cost_usd: number | null
  duration_ms: number
  is_error: boolean
  verify: VerifyResult
  created_at: string
}

/** Accumulates a single Cody run's trajectory from raw stream-json events. */
export class TrajectoryCapture {
  private steps: TrajectoryStep[] = []
  private turn = 0
  private numTurns = 0
  private cost: number | null = null
  private isError = false

  constructor(
    readonly chatId: string,
    readonly task: string,
    readonly model: string,
  ) {}

  /** Feed each raw stream-json event (called from the streaming loop). */
  observe(event: any): void {
    if (!event || typeof event !== 'object') return
    if (event.type === 'assistant' && event.message?.content) {
      this.turn++
      for (const block of event.message.content) {
        if (block.type === 'text' && block.text) {
          this.steps.push({ turn: this.turn, role: 'assistant', text: String(block.text).slice(0, 8000) })
        }
        if (block.type === 'tool_use' && block.name) {
          this.steps.push({
            turn: this.turn,
            role: 'assistant',
            tool: block.name,
            toolInput: truncateInput(block.input),
          })
        }
      }
    } else if (event.type === 'user' && event.message?.content) {
      // tool_result blocks come back as user-role messages
      for (const block of event.message.content) {
        if (block.type === 'tool_result') {
          const content = Array.isArray(block.content)
            ? block.content.map((c: any) => c.text || '').join('')
            : String(block.content || '')
          this.steps.push({ turn: this.turn, role: 'tool_result', toolResult: content.slice(0, 4000) })
        }
      }
    } else if (event.type === 'result') {
      // Prefer the reported turn count, but fall back to the observed number of
      // assistant turns (the result event can report 0 on early termination).
      this.numTurns = event.num_turns || this.turn
      this.cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null
      this.isError = Boolean(event.is_error)
    }
  }

  /** Finalize: snapshot the file tree, auto-verify, and return the record. */
  async finalize(worktreePath: string, startTime: number): Promise<TrajectoryRecord> {
    const fileTree = safeFileTree(worktreePath)
    const verify = await autoVerify(worktreePath)
    return {
      chat_id: this.chatId,
      task: this.task.slice(0, 4000),
      model: this.model,
      steps: this.steps,
      file_tree: fileTree,
      num_turns: this.numTurns || this.turn,
      total_cost_usd: this.cost,
      duration_ms: Date.now() - startTime,
      is_error: this.isError,
      verify,
      created_at: new Date().toISOString(),
    }
  }
}

function truncateInput(input: unknown): unknown {
  try {
    const s = JSON.stringify(input)
    if (s.length <= 2000) return input
    return { _truncated: true, preview: s.slice(0, 2000) }
  } catch {
    return null
  }
}

/** List files in the worktree (excluding node_modules/.git), capped. */
function safeFileTree(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 6 || out.length > 300) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else out.push(path.relative(root, full))
    }
  }
  walk(root, 0)
  return out
}

/**
 * Objective, execution-based reward. Runs the generated project and checks
 * whether it installs, builds, and responds — no human judgment needed.
 */
async function autoVerify(worktreePath: string): Promise<VerifyResult> {
  const hasPkg = fs.existsSync(path.join(worktreePath, 'package.json'))
  if (!hasPkg) {
    return { installed: null, built: null, ran: null, httpOk: null, reward: 0, detail: 'no package.json' }
  }

  const installed = await run('npm', ['install', '--no-audit', '--no-fund', '--loglevel=error'], worktreePath, 180_000)
  if (!installed.ok) {
    return { installed: false, built: null, ran: null, httpOk: null, reward: 0, detail: `install failed: ${installed.detail}` }
  }

  // Try a build if one is defined (non-fatal if absent).
  const pkg = readJson(path.join(worktreePath, 'package.json'))
  const scripts = (pkg?.scripts || {}) as Record<string, string>
  let built: boolean | null = null
  if (scripts.build) {
    const b = await run('npm', ['run', 'build'], worktreePath, 240_000)
    built = b.ok
  }

  // A trajectory that installs (and builds if it has a build) is a positive
  // reward. Full run+HTTP probing is left to a deeper offline verifier since it
  // needs port allocation; install+build is a strong, cheap signal.
  const reward: 0 | 1 = installed.ok && built !== false ? 1 : 0
  return {
    installed: true,
    built,
    ran: null,
    httpOk: null,
    reward,
    detail: reward ? 'install' + (built ? '+build ok' : ' ok') : 'build failed',
  }
}

function readJson(p: string): any {
  try { return JSON.parse(fs.readFileSync(p, 'utf8')) } catch { return null }
}

function run(cmd: string, args: string[], cwd: string, timeoutMs: number): Promise<{ ok: boolean; detail: string }> {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, stdio: ['ignore', 'pipe', 'pipe'] })
    let err = ''
    const timer = setTimeout(() => { child.kill('SIGKILL'); resolve({ ok: false, detail: 'timeout' }) }, timeoutMs)
    child.stderr?.on('data', (d) => { err += d.toString().slice(0, 500) })
    child.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, detail: String(e).slice(0, 200) }) })
    child.on('exit', (code) => { clearTimeout(timer); resolve({ ok: code === 0, detail: code === 0 ? 'ok' : err.slice(0, 200) }) })
  })
}

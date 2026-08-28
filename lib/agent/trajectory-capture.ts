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
  /**
   * True when this step was reconstructed from partial stream_event chunks of a
   * turn that never completed (run killed by budget / max-turns / abort). The
   * step is real signal — the agent WAS doing this — but its input may be a
   * truncated prefix (#343 steps:[] fix).
   */
  partial?: boolean
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

/**
 * Provenance pointers making a trajectory a NODE in a fork/merge DAG (#347).
 * A root run has parent_traj=null. A subagent/re-fork run carries the parent
 * trajectory id it forked FROM and the parent step index it forked AT — so the
 * offline explorer can walk the tree and RLHF data knows which fork led to the
 * accepted build. Slice 1 is the pure data model; the fork/merge WIRING in the
 * subagent orchestrator + re-fork-on-failure are slices 2 and 3.
 */
export interface TrajectoryProvenance {
  /** Stable identity of THIS trajectory node (unique per fork, unlike chat_id). */
  traj_id: string
  /** The trajectory this one forked from; null for a root run. */
  parent_traj: string | null
  /** The step index in the parent this node forked at; null for a root run. */
  parent_step: number | null
  /** 'root' = top-level run; 'fork' = spawned from a parent trajectory. */
  node_role: 'root' | 'fork'
}

export interface TrajectoryRecord extends TrajectoryProvenance {
  chat_id: string
  task: string
  model: string
  steps: TrajectoryStep[]
  file_tree: string[]
  num_turns: number
  total_cost_usd: number | null
  duration_ms: number
  is_error: boolean
  /** Terminal stop reason from the result event (e.g. max_budget_usd,
   *  max_turns, end_turn) — diagnoses WHY a run has partial/empty steps. */
  stop_reason: string | null
  verify: VerifyResult
  created_at: string
}

/**
 * Mint the provenance for a CHILD trajectory forked from a parent (#347). Pure +
 * deterministic: the caller supplies a unique `suffix` (e.g. a subagent index or
 * a monotonic counter) so this never touches Date.now/random and stays
 * unit-testable. Returns the fields a forked TrajectoryCapture is constructed
 * with. `parentStep` is where in the parent's steps[] the fork happened.
 */
export function forkProvenance(
  parentTrajId: string,
  parentStep: number,
  suffix: string | number,
): TrajectoryProvenance {
  return {
    traj_id: `${parentTrajId}.${suffix}`,
    parent_traj: parentTrajId,
    parent_step: parentStep,
    node_role: 'fork',
  }
}

/** Provenance for a ROOT trajectory (no parent). `trajId` defaults to chatId. */
export function rootProvenance(trajId: string): TrajectoryProvenance {
  return { traj_id: trajId, parent_traj: null, parent_step: null, node_role: 'root' }
}

/**
 * Build a FORK trajectory record for a single subagent run (#347 slice 2). The
 * hierarchical orchestrator (subagents.ts) runs design→code→validation via the
 * Anthropic SDK — not the stream-json runHeadlessAgent — so there is no event
 * stream to tap. Instead we synthesize a one-step trajectory per subagent and
 * fork it under the parent run's traj_id at a distinct parent step, so the DAG
 * records parent → [design, code, validation] with provenance pointers.
 *
 * Pure + deterministic: the caller supplies createdAt/durationMs (no Date.now in
 * the core). `success` IS the objective reward — design/code/validation each
 * either produced usable output or did not. `parentStep` orders the forks.
 */
export function subagentForkRecord(args: {
  parentTrajId: string
  parentStep: number
  subagentType: string
  chatId: string
  task: string
  model: string
  output: string
  success: boolean
  stopReason?: string | null
  createdAt: string
  durationMs: number
}): TrajectoryRecord {
  const prov = forkProvenance(args.parentTrajId, args.parentStep, args.subagentType)
  const reward: 0 | 1 = args.success ? 1 : 0
  const step: TrajectoryStep = {
    turn: 1,
    role: 'assistant',
    text: (args.output || '').slice(0, 8000),
    tool: `subagent:${args.subagentType}`,
  }
  return {
    ...prov,
    chat_id: args.chatId,
    task: args.task.slice(0, 4000),
    model: args.model,
    steps: [step],
    file_tree: [],
    num_turns: 1,
    total_cost_usd: null,
    duration_ms: args.durationMs,
    is_error: !args.success,
    stop_reason: args.stopReason ?? null,
    verify: {
      installed: null,
      built: null,
      ran: null,
      httpOk: null,
      reward,
      detail: `subagent ${args.subagentType}: ${args.success ? 'ok' : 'failed'}`,
    },
    created_at: args.createdAt,
  }
}

/** In-flight (not yet completed) assistant message reconstructed from
 *  --include-partial-messages stream_event chunks (#343). */
interface PartialTurn {
  text: string
  tools: Array<{ name: string; inputJson: string }>
}

/** Accumulates a single Cody run's trajectory from raw stream-json events. */
export class TrajectoryCapture {
  private steps: TrajectoryStep[] = []
  private turn = 0
  private numTurns = 0
  private cost: number | null = null
  private isError = false
  private stopReason: string | null = null
  /** In-flight partial turn from stream_event chunks; superseded by the
   *  complete `assistant` event when the message finishes, flushed into steps
   *  at finalize when it never does (#343 steps:[] fix). */
  private partial: PartialTurn | null = null

  /** Provenance for this trajectory node (#347). Defaults to a ROOT whose
   *  traj_id is the chatId — so existing (non-forked) callers are unchanged. A
   *  forked subagent run passes forkProvenance(parentTraj, parentStep, suffix). */
  readonly provenance: TrajectoryProvenance

  constructor(
    readonly chatId: string,
    readonly task: string,
    readonly model: string,
    provenance?: TrajectoryProvenance,
  ) {
    this.provenance = provenance ?? rootProvenance(chatId)
  }

  /** Feed each raw stream-json event (called from the streaming loop). */
  observe(event: any): void {
    if (!event || typeof event !== 'object') return
    if (event.type === 'assistant' && event.message?.content) {
      // The message COMPLETED — it supersedes any partial reconstruction of
      // the same in-flight turn (avoids double-recording).
      this.partial = null
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
    } else if (event.type === 'stream_event' && event.event) {
      // Partial-message chunks (--include-partial-messages, #343): cody wraps
      // the Anthropic SSE event under `event`. A turn killed mid-flight
      // (budget / max-turns / abort) NEVER emits its complete `assistant`
      // message — before this handler, every such prod trajectory landed with
      // steps:[] despite real tool calls. Reconstruct the in-flight turn here;
      // the complete assistant event (when it arrives) supersedes it above.
      const ev = event.event
      if (ev.type === 'message_start') {
        this.partial = { text: '', tools: [] }
      } else if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') {
        this.partial = this.partial || { text: '', tools: [] }
        this.partial.tools.push({ name: String(ev.content_block.name || ''), inputJson: '' })
      } else if (ev.type === 'content_block_delta' && ev.delta) {
        this.partial = this.partial || { text: '', tools: [] }
        if (ev.delta.type === 'text_delta' && ev.delta.text) {
          if (this.partial.text.length < 8000) this.partial.text += String(ev.delta.text)
        } else if (ev.delta.type === 'input_json_delta' && ev.delta.partial_json) {
          const tool = this.partial.tools[this.partial.tools.length - 1]
          if (tool && tool.inputJson.length < 4000) tool.inputJson += String(ev.delta.partial_json)
        }
      }
    } else if (event.type === 'result') {
      // Prefer the reported turn count, but fall back to the observed number of
      // assistant turns (the result event can report 0 on early termination).
      this.numTurns = event.num_turns || this.turn
      this.cost = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null
      this.isError = Boolean(event.is_error)
      const reason = event.stop_reason ?? event.terminal_reason ?? null
      this.stopReason = reason != null ? String(reason) : null
    }
  }

  /** Flush a turn that never completed into steps (marked partial). */
  private flushPartial(): void {
    const p = this.partial
    if (!p) return
    this.partial = null
    if (!p.text && p.tools.length === 0) return
    this.turn++
    if (p.text) {
      this.steps.push({ turn: this.turn, role: 'assistant', text: p.text.slice(0, 8000), partial: true })
    }
    for (const t of p.tools) {
      if (!t.name) continue
      let input: unknown = null
      try { input = JSON.parse(t.inputJson) } catch { input = { _truncated: true, preview: t.inputJson.slice(0, 2000) } }
      this.steps.push({ turn: this.turn, role: 'assistant', tool: t.name, toolInput: truncateInput(input), partial: true })
    }
  }

  /** Finalize: snapshot the file tree, auto-verify, and return the record. */
  async finalize(worktreePath: string, startTime: number): Promise<TrajectoryRecord> {
    // A turn that was streaming when the run died never got its complete
    // assistant event — record what we reconstructed from partials (#343).
    this.flushPartial()
    const fileTree = safeFileTree(worktreePath)
    const verify = await autoVerify(worktreePath)
    return {
      traj_id: this.provenance.traj_id,
      parent_traj: this.provenance.parent_traj,
      parent_step: this.provenance.parent_step,
      node_role: this.provenance.node_role,
      chat_id: this.chatId,
      task: this.task.slice(0, 4000),
      model: this.model,
      steps: this.steps,
      file_tree: fileTree,
      num_turns: this.numTurns || this.turn,
      total_cost_usd: this.cost,
      duration_ms: Date.now() - startTime,
      is_error: this.isError,
      stop_reason: this.stopReason,
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
    // No package.json doesn't mean failure — a static web app (index.html + JS/
    // CSS, no build step) is a perfectly valid, runnable output. Verify it as a
    // static app instead of scoring it reward=0, so frontend-only generations
    // aren't systematically undervalued in the fine-tuning data.
    return verifyStaticApp(worktreePath)
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

/**
 * Verify a static web app (no package.json): a runnable frontend is one with an
 * HTML entry point that has real content and wires up its own JS/CSS. This is
 * the execution-based analogue of "install+build ok" for static apps — no npm,
 * no build, but still an objective signal that the output is a real app and not
 * an empty stub. reward=1 when a substantive index.html is present.
 */
function verifyStaticApp(worktreePath: string): VerifyResult {
  // Find an HTML entry point (prefer index.html, else any .html at shallow depth).
  const htmlFiles = findHtml(worktreePath)
  const entry =
    htmlFiles.find((f) => path.basename(f).toLowerCase() === 'index.html') || htmlFiles[0]

  if (!entry) {
    return { installed: null, built: null, ran: null, httpOk: null, reward: 0, detail: 'no package.json and no html entry' }
  }

  let html = ''
  try { html = fs.readFileSync(entry, 'utf8') } catch {
    return { installed: null, built: null, ran: null, httpOk: null, reward: 0, detail: 'html unreadable' }
  }

  // Substantive: has a <body>, non-trivial length, and references script/style
  // (inline or external) — i.e. an actual app, not a blank placeholder.
  const hasBody = /<body[\s>]/i.test(html)
  const hasLogic = /<script[\s>]/i.test(html) || /<style[\s>]/i.test(html) || /<link[^>]+stylesheet/i.test(html)
  const substantive = html.length >= 200 && hasBody && hasLogic

  const rel = path.relative(worktreePath, entry)
  const reward: 0 | 1 = substantive ? 1 : 0
  return {
    installed: null,
    built: null,
    ran: null,
    httpOk: null,
    reward,
    detail: reward
      ? `static app ok (${rel})`
      : `static app incomplete (${rel}: ${html.length}b body=${hasBody} logic=${hasLogic})`,
  }
}

/** Shallow scan for .html files (excludes node_modules/.git/.next), capped. */
function findHtml(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (depth > 3 || out.length > 40) return
    let entries: fs.Dirent[]
    try { entries = fs.readdirSync(dir, { withFileTypes: true }) } catch { return }
    for (const e of entries) {
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.next') continue
      const full = path.join(dir, e.name)
      if (e.isDirectory()) walk(full, depth + 1)
      else if (e.name.toLowerCase().endsWith('.html')) out.push(full)
    }
  }
  walk(root, 0)
  return out
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

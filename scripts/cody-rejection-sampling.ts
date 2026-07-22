/**
 * Rejection-sampling harness for Cody fine-tuning data.
 *
 * For each task: run N Cody attempts in isolated worktrees, capture each
 * trajectory, auto-verify (install/build), and KEEP ONLY verified-passing
 * runs (reward=1). Passing trajectories are stored as SFT examples in ZeroDB
 * (table: cody_sft). This turns "we can capture Cody runs" into "we have a
 * fine-tuning dataset of verified-working agentic trajectories."
 *
 * Usage:
 *   ZERODB_API_TOKEN=<sk_...> npx tsx scripts/cody-rejection-sampling.ts \
 *     [--n 3] [--tasks path/to/tasks.json] [--dry] [--max-tasks 5]
 *
 * Task file format: JSON array of { id, prompt } (defaults to a built-in set).
 * Cody creds: read from ~/.cody/credentials.json if ZERODB_API_TOKEN unset.
 */
import { spawn } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TrajectoryCapture, type TrajectoryRecord } from '../lib/agent/trajectory-capture'

const CODY_CLI = path.join(os.homedir(), 'Desktop/cody-cli/dist/cli.js')
const SFT_TABLE = 'cody_sft'
const PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'
const API_BASE = process.env.AINATIVE_API_BASE_URL || 'https://api.ainative.studio'

// ---- config ----
const argv = process.argv.slice(2)
const argVal = (flag: string, def?: string) => {
  const i = argv.indexOf(flag)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : def
}
const N = parseInt(argVal('--n', '3')!, 10)
const DRY = argv.includes('--dry')
const MAX_TASKS = parseInt(argVal('--max-tasks', '999')!, 10)
const TASKS_FILE = argVal('--tasks')

const DEFAULT_TASKS = [
  { id: 'todo-api', prompt: 'Build a full-stack task manager: package.json (express + start script), server/index.js (Express with in-memory tasks and REST GET/POST/PUT/DELETE /api/tasks, serving public/ statically), public/index.html (task list UI wired to the API). Use the Write tool. Do it now.' },
  { id: 'notes-crud', prompt: 'Build a notes app: package.json (express), server/index.js (Express REST /api/notes with in-memory store, GET/POST/DELETE), public/index.html (add/list/delete notes via fetch). Write all files now.' },
  { id: 'counter-ssr', prompt: 'Build a minimal Express app: package.json (express + start script) and server/index.js serving an HTML page with a server-rendered counter and GET / plus GET /health returning 200. Write the files now.' },
]

function getToken(): string {
  const t = process.env.ZERODB_API_TOKEN || process.env.AINATIVE_API_KEY
  if (t) return t
  try {
    const creds = JSON.parse(fs.readFileSync(path.join(os.homedir(), '.cody/credentials.json'), 'utf8'))
    return creds.api_key
  } catch {
    console.error('No token: set ZERODB_API_TOKEN or provide ~/.cody/credentials.json')
    process.exit(1)
  }
}

/** Run one Cody attempt in an isolated worktree, return the captured+verified trajectory. */
function runAttempt(taskId: string, prompt: string, attempt: number, token: string): Promise<TrajectoryRecord> {
  return new Promise((resolve) => {
    const work = fs.mkdtempSync(path.join(os.tmpdir(), `cody-rs-${taskId}-${attempt}-`))
    const cap = new TrajectoryCapture(`${taskId}#${attempt}`, prompt, 'kimi-k2')
    const start = Date.now()
    const child = spawn(
      'node',
      [CODY_CLI, '--print', prompt, '--output-format', 'stream-json', '--verbose',
        '--dangerously-skip-permissions', '--max-turns', '15', '--max-budget-usd', '2'],
      { cwd: work, env: { ...process.env, ANTHROPIC_API_KEY: token, ANTHROPIC_BASE_URL: API_BASE } },
    )
    // hard cap so a hung run can't stall the sweep
    const killer = setTimeout(() => child.kill('SIGKILL'), 300_000)
    let buf = ''
    child.stdout.on('data', (d) => {
      buf += d.toString()
      const lines = buf.split('\n'); buf = lines.pop() || ''
      for (const l of lines) { const t = l.trim(); if (!t) continue; try { cap.observe(JSON.parse(t)) } catch {} }
    })
    child.on('exit', async () => {
      clearTimeout(killer)
      const rec = await cap.finalize(work, start)
      try { fs.rmSync(work, { recursive: true, force: true }) } catch {}
      resolve(rec)
    })
    child.on('error', async () => {
      clearTimeout(killer)
      const rec = await cap.finalize(work, start)
      resolve(rec)
    })
  })
}

async function storeSFT(rec: TrajectoryRecord, token: string): Promise<boolean> {
  if (DRY) return true
  try {
    const res = await fetch(`${API_BASE}/api/v1/projects/${PROJECT_ID}/database/tables/${SFT_TABLE}/rows`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        row_data: {
          chat_id: rec.chat_id, task: rec.task, model: rec.model,
          num_turns: rec.num_turns, total_cost_usd: rec.total_cost_usd,
          reward: rec.verify.reward, verify_detail: rec.verify.detail,
          file_count: rec.file_tree.length, file_tree: JSON.stringify(rec.file_tree),
          steps: JSON.stringify(rec.steps), created_at: rec.created_at,
        },
      }),
    })
    return res.ok
  } catch { return false }
}

async function ensureTable(token: string): Promise<void> {
  if (DRY) return
  await fetch(`${API_BASE}/api/v1/projects/${PROJECT_ID}/database/tables`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ table_name: SFT_TABLE, description: 'Verified-passing Cody trajectories for SFT (rejection sampling)' }),
  }).catch(() => {})
}

async function main() {
  const token = getToken()
  const tasks = (TASKS_FILE ? JSON.parse(fs.readFileSync(TASKS_FILE, 'utf8')) : DEFAULT_TASKS).slice(0, MAX_TASKS)
  console.log(`Rejection sampling: ${tasks.length} tasks × N=${N} attempts each${DRY ? ' (DRY RUN — no storage)' : ''}`)
  await ensureTable(token)

  let kept = 0, total = 0
  const summary: Array<{ task: string; passed: number; attempts: number }> = []

  for (const task of tasks) {
    let passed = 0
    console.log(`\n=== TASK: ${task.id} ===`)
    for (let a = 1; a <= N; a++) {
      total++
      const rec = await runAttempt(task.id, task.prompt, a, token)
      const ok = rec.verify.reward === 1 && !rec.is_error
      console.log(`  attempt ${a}: turns=${rec.num_turns} files=${rec.file_tree.length} tools=[${rec.steps.filter(s => s.tool).map(s => s.tool).join(',')}] verify=${rec.verify.detail} -> ${ok ? 'KEEP ✅' : 'reject ✗'}`)
      if (ok) {
        const stored = await storeSFT(rec, token)
        if (stored) { kept++; passed++ }
        else console.log('    (store failed)')
      }
    }
    summary.push({ task: task.id, passed, attempts: N })
  }

  console.log('\n========== SUMMARY ==========')
  for (const s of summary) console.log(`  ${s.task}: ${s.passed}/${s.attempts} verified-passing kept`)
  console.log(`  TOTAL: ${kept}/${total} attempts kept as SFT examples (pass rate ${((kept / total) * 100).toFixed(0)}%)`)
}

main().catch((e) => { console.error(e); process.exit(1) })

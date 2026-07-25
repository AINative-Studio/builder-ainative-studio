import { describe, it, expect, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { TrajectoryCapture } from '@/lib/agent/trajectory-capture'

/**
 * autoVerify's reward for static web apps (no package.json). A frontend-only
 * app (index.html + JS/CSS) is a valid, runnable output and must score
 * reward=1 — not be treated as a failure — so it isn't undervalued in the
 * fine-tuning data. Verified via the public finalize() since autoVerify is
 * module-private.
 */

const dirs: string[] = []
function mkApp(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-sv-'))
  dirs.push(dir)
  for (const [f, c] of Object.entries(files)) {
    const full = path.join(dir, f)
    fs.mkdirSync(path.dirname(full), { recursive: true })
    fs.writeFileSync(full, c)
  }
  return dir
}

afterEach(() => {
  while (dirs.length) {
    const d = dirs.pop()!
    try { fs.rmSync(d, { recursive: true, force: true }) } catch { /* ignore */ }
  }
})

async function verify(files: Record<string, string>) {
  const dir = mkApp(files)
  const cap = new TrajectoryCapture('chat', 'task', 'sonnet')
  const rec = await cap.finalize(dir, Date.now())
  return rec.verify
}

const GOOD_HTML =
  '<!doctype html><html><head><style>body{margin:0}</style></head><body>' +
  '<h1>Counter</h1><button id="b">+</button><span id="n">0</span>' +
  '<script>let n=0;document.getElementById("b").onclick=()=>{n++}</script></body></html>'

describe('autoVerify static apps (no package.json)', () => {
  it('rewards a substantive static app (index.html with body + script)', async () => {
    const v = await verify({ 'index.html': GOOD_HTML, 'style.css': 'body{}' })
    expect(v.reward).toBe(1)
    expect(v.detail).toMatch(/static app ok/)
  })

  it('does not reward an empty html stub', async () => {
    const v = await verify({ 'index.html': '<html></html>' })
    expect(v.reward).toBe(0)
    expect(v.detail).toMatch(/incomplete/)
  })

  it('does not reward a project with no html entry at all', async () => {
    const v = await verify({ 'README.md': 'hello', 'notes.txt': 'x' })
    expect(v.reward).toBe(0)
    expect(v.detail).toMatch(/no html entry/)
  })

  it('finds index.html nested one level down', async () => {
    const v = await verify({ 'public/index.html': GOOD_HTML })
    expect(v.reward).toBe(1)
  })
})

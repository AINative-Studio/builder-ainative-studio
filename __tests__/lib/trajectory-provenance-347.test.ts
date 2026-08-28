import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  TrajectoryCapture,
  forkProvenance,
  rootProvenance,
} from '@/lib/agent/trajectory-capture'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

/**
 * #347 slice 1 — trajectory provenance data model. A trajectory is a NODE in a
 * fork/merge DAG: a root run has no parent; a forked run carries parent_traj +
 * parent_step pointers. These lock the pure model + that TrajectoryCapture
 * threads provenance through to the finalized record (default = root, so
 * existing callers are unchanged).
 */

describe('provenance helpers (#347)', () => {
  it('rootProvenance: no parent, node_role root, traj_id = given id', () => {
    expect(rootProvenance('chatA')).toEqual({
      traj_id: 'chatA',
      parent_traj: null,
      parent_step: null,
      node_role: 'root',
    })
  })

  it('forkProvenance: child id derived from parent + suffix, carries pointers', () => {
    expect(forkProvenance('chatA', 3, 'sub1')).toEqual({
      traj_id: 'chatA.sub1',
      parent_traj: 'chatA',
      parent_step: 3,
      node_role: 'fork',
    })
  })

  it('forkProvenance is pure/deterministic (same inputs → same id)', () => {
    expect(forkProvenance('p', 0, 2)).toEqual(forkProvenance('p', 0, 2))
  })

  it('nested forks chain traj_id (a fork of a fork)', () => {
    const lvl1 = forkProvenance('root', 1, 'a')
    const lvl2 = forkProvenance(lvl1.traj_id, 4, 'b')
    expect(lvl2.traj_id).toBe('root.a.b')
    expect(lvl2.parent_traj).toBe('root.a')
    expect(lvl2.parent_step).toBe(4)
  })
})

describe('TrajectoryCapture provenance threading (#347)', () => {
  let dir: string
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'traj-prov-'))
    fs.writeFileSync(path.join(dir, 'index.html'), '<html><body><script>1</script></body></html>')
  })
  afterEach(() => {
    try { fs.rmSync(dir, { recursive: true, force: true }) } catch { /* ignore */ }
    vi.restoreAllMocks()
  })

  it('defaults to ROOT provenance when none is passed (back-compat)', async () => {
    const cap = new TrajectoryCapture('chatX', 'task', 'model')
    expect(cap.provenance).toEqual(rootProvenance('chatX'))
    const rec = await cap.finalize(dir, Date.now())
    expect(rec.traj_id).toBe('chatX')
    expect(rec.parent_traj).toBeNull()
    expect(rec.parent_step).toBeNull()
    expect(rec.node_role).toBe('root')
  })

  it('a FORKED capture carries parent pointers into the finalized record', async () => {
    const prov = forkProvenance('parentTraj', 5, 'idx0')
    const cap = new TrajectoryCapture('childChat', 'subtask', 'model', prov)
    const rec = await cap.finalize(dir, Date.now())
    expect(rec.traj_id).toBe('parentTraj.idx0')
    expect(rec.parent_traj).toBe('parentTraj')
    expect(rec.parent_step).toBe(5)
    expect(rec.node_role).toBe('fork')
    // chat_id is still the run's own chat id — distinct from traj_id.
    expect(rec.chat_id).toBe('childChat')
  })
})

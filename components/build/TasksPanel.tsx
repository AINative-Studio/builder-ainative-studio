'use client'

/**
 * TasksPanel (#55) — the company's REAL Tasks/Backlog on the Live dashboard.
 *
 * Replaces the hardcoded `tonight` array in Live.tsx with a first-class,
 * stateful list of the company's agent tasks across six lifecycle stages
 * (To Do / Recurring / In Progress / Completed / Rejected / Failed). Tasks are
 * loaded from /api/build/tasks (persisted per {owner, company} in ZeroDB), which
 * also surfaces REAL swarm task_ids and the nightly loop's Recurring task.
 *
 * Features:
 *  - stage tabs (All + the six stages) with live counts,
 *  - task cards with title, stage badge, source, created/updated,
 *  - a VIEW detail panel (what the agent did, output, task_id),
 *  - an honest empty state for a brand-new company.
 *
 * Chrome: reuses the `.modernist` `.m-live-card`, `.st` status pills, and
 * `.m-chip` classes already used by the dashboard, so it matches #67's systems
 * grid without introducing a new visual language.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  TASK_STAGES,
  STAGE_LABELS,
  type BuildTask,
  type TaskStage,
} from '@/lib/build/task-store'

/** Map a stage to the `.st` pill modifier so badges match the dashboard. */
function stageStClass(stage: TaskStage): string {
  switch (stage) {
    case 'in_progress':
    case 'recurring':
      return 'is-running'
    case 'completed':
      return 'is-done'
    case 'rejected':
    case 'failed':
      return 'is-needs'
    default:
      return '' // to_do — neutral pill
  }
}

/** Human label for a task's source. */
const SOURCE_LABEL: Record<BuildTask['source'], string> = {
  cody: 'Cody',
  swarm: 'swarm',
  recurring: 'recurring',
}

/** Compact "x ago" for a timestamp, or '' when absent/invalid. */
function ago(iso?: string): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

type FilterTab = 'all' | TaskStage

export function TasksPanel({ companyId }: { companyId: string }) {
  const [tasks, setTasks] = useState<BuildTask[]>([])
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [loaded, setLoaded] = useState(false)
  const [tab, setTab] = useState<FilterTab>('all')
  const [selected, setSelected] = useState<BuildTask | null>(null)

  const load = useCallback(() => {
    let alive = true
    setLoaded(false)
    fetch(`/api/build/tasks?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setTasks(Array.isArray(d?.tasks) ? d.tasks : [])
        setCounts(d?.counts && typeof d.counts === 'object' ? d.counts : {})
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  // Hydrate on mount / company change (#55) — an honest empty backlog for a
  // brand-new company, real tasks otherwise. Never fabricated.
  useEffect(() => load(), [load])

  const total = useMemo(
    () => TASK_STAGES.reduce((n, s) => n + (counts[s] || 0), 0),
    [counts],
  )

  const visible = useMemo(
    () => (tab === 'all' ? tasks : tasks.filter((t) => t.stage === tab)),
    [tasks, tab],
  )

  return (
    <div className="m-live-card" data-testid="tasks-panel">
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">◇</span> Tasks &amp; backlog
      </div>

      {/* Stage filter tabs — All + the six lifecycle stages, with counts. */}
      <div className="m-task-tabs" role="tablist" aria-label="Filter tasks by stage">
        <button
          role="tab"
          aria-selected={tab === 'all'}
          className={`m-task-tab ${tab === 'all' ? 'is-active' : ''}`}
          data-testid="task-tab-all"
          onClick={() => setTab('all')}
        >
          All <span className="m-task-tab-n">{total}</span>
        </button>
        {TASK_STAGES.map((s) => (
          <button
            key={s}
            role="tab"
            aria-selected={tab === s}
            className={`m-task-tab ${tab === s ? 'is-active' : ''}`}
            data-testid={`task-tab-${s}`}
            onClick={() => setTab(s)}
          >
            {STAGE_LABELS[s]} <span className="m-task-tab-n">{counts[s] || 0}</span>
          </button>
        ))}
      </div>

      {/* Body: honest empty state, or the filtered task cards. */}
      {loaded && total === 0 ? (
        <p className="m-mono m-task-empty" data-testid="tasks-empty">
          No tasks yet. As Cody and the swarm work on {companyId ? 'your company' : 'this company'},
          dispatched tasks appear here with live status. Enroll the nightly loop and it shows as a Recurring task.
        </p>
      ) : !loaded ? (
        <p className="m-mono m-task-empty" data-testid="tasks-loading">loading tasks…</p>
      ) : visible.length === 0 ? (
        <p className="m-mono m-task-empty" data-testid="tasks-stage-empty">
          No {STAGE_LABELS[(tab as TaskStage)] || 'matching'} tasks.
        </p>
      ) : (
        <ul className="m-task-list" data-testid="task-list">
          {visible.map((t) => (
            <li key={t.id} className="m-task-card" data-testid="task-card" data-stage={t.stage}>
              <div className="m-task-card-top">
                <span className={`st ${stageStClass(t.stage)}`} data-testid="task-stage-badge">
                  {STAGE_LABELS[t.stage]}
                </span>
                <span className="m-chip m-task-source" data-testid="task-source">{SOURCE_LABEL[t.source]}</span>
              </div>
              <p className="m-task-title" data-testid="task-title">{t.title}</p>
              <div className="m-task-card-foot m-mono">
                <span className="m-task-meta">{ago(t.updatedAt) || ago(t.createdAt)}</span>
                <button
                  className="btn-ghost m-task-view"
                  data-testid="task-view"
                  onClick={() => setSelected(t)}
                >
                  VIEW →
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {/* VIEW detail — what the agent did, its output, and the real task_id. */}
      {selected && (
        <div className="m-task-detail" role="dialog" aria-label="Task detail" data-testid="task-detail">
          <div className="m-task-detail-head">
            <span className={`st ${stageStClass(selected.stage)}`}>{STAGE_LABELS[selected.stage]}</span>
            <button className="btn-ghost m-task-detail-close" data-testid="task-detail-close" onClick={() => setSelected(null)}>
              close ✕
            </button>
          </div>
          <p className="m-task-detail-title" data-testid="task-detail-title">{selected.title}</p>
          {selected.detail && <p className="m-task-detail-body">{selected.detail}</p>}
          <dl className="m-mono m-task-detail-meta">
            <div><dt>source</dt><dd>{SOURCE_LABEL[selected.source]}</dd></div>
            <div><dt>created</dt><dd>{ago(selected.createdAt) || '—'}</dd></div>
            <div><dt>updated</dt><dd>{ago(selected.updatedAt) || '—'}</dd></div>
            {selected.taskId && (
              <div><dt>task_id</dt><dd data-testid="task-detail-taskid">{selected.taskId}</dd></div>
            )}
          </dl>
          {selected.output ? (
            <pre className="m-task-detail-output" data-testid="task-detail-output">{selected.output}</pre>
          ) : (
            <p className="m-mono m-task-detail-noout">No agent output yet.</p>
          )}
        </div>
      )}
    </div>
  )
}

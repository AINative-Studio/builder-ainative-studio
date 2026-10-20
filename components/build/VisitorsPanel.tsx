'use client'

/**
 * VisitorsPanel (#1126 governing-priority follow-up) — real pageviews from
 * the generated landing page's mandated /api/db/visitors beacon, surfaced on
 * the Live dashboard. Modeled directly on WaitlistPanel.tsx's pattern.
 *
 * The write side already worked: primitive-catalog.ts's VISITOR TRACKING
 * block has every generated app fire a real pageview beacon on mount, and
 * the Live dashboard's "visitors" hero metric already read the count back
 * (#483/#563) — but until now there was no founder-facing panel showing the
 * actual visits behind that number, only a bare count. This panel is the
 * missing detail view, same bar as WaitlistPanel: real data, real empty
 * state, zero fabrication.
 *
 * Chrome: reuses the same `.m-live-card`/`.st`/`.m-chip`/`.m-task-*` classes
 * WaitlistPanel/GrowthPanel/AutoModePanel already established.
 */

import { useCallback, useEffect, useState } from 'react'

interface Props {
  companyId: string
}

interface VisitorEntry {
  path: string
  visitedAt: string
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function VisitorsPanel({ companyId }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [entries, setEntries] = useState<VisitorEntry[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/build/visitors?slug=${encodeURIComponent(companyId)}`)
      const data = res.ok ? await res.json() : null
      setEntries(Array.isArray(data?.entries) ? data.entries : [])
    } catch {
      setEntries([])
    } finally {
      setLoaded(true)
    }
  }, [companyId])

  useEffect(() => { load() }, [load])

  const downloadCsv = useCallback(() => {
    const header = 'path,visitedAt'
    const rows = entries.map((e) => `${csvEscape(e.path)},${csvEscape(e.visitedAt)}`)
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${companyId}-visitors.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [entries, companyId])

  if (!loaded) return null

  return (
    <div className="m-live-card" data-testid="visitors-panel">
      <div className="m-task-card-h">
        <span className="st">Visitors</span>
        <span className="m-chip" data-testid="visitors-count">
          {entries.length} visit{entries.length === 1 ? '' : 's'}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="m-mono m-metric-note" data-testid="visitors-empty">
          No visits yet — real pageviews from your landing page will show up here.
        </p>
      ) : (
        <>
          <div className="m-task-card" data-testid="visitors-list">
            {entries.slice(0, 20).map((e, i) => (
              <div className="m-task-card-h" key={`${e.path}-${e.visitedAt}-${i}`}>
                <span className="m-mono" data-testid="visitors-path">{e.path || '—'}</span>
                <span className="m-task-meta" data-testid="visitors-visited-at">
                  {e.visitedAt ? new Date(e.visitedAt).toLocaleString() : '—'}
                </span>
              </div>
            ))}
          </div>
          {entries.length > 20 && (
            <p className="m-mono m-metric-note">+{entries.length - 20} more — export CSV to see all.</p>
          )}
          <button className="btn-secondary" data-testid="visitors-export" onClick={downloadCsv}>
            Export CSV
          </button>
        </>
      )}
    </div>
  )
}

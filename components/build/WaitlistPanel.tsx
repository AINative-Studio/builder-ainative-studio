'use client'

/**
 * WaitlistPanel (#844) — real signups from the generated landing page's hero
 * waitlist form, surfaced on the Live dashboard.
 *
 * The write side already worked: primitive-catalog.ts's EMAIL / WAITLIST
 * CAPTURE block has every generated app persist real signups via
 * POST /api/db/waitlist. Nothing ever read them back — a founder had
 * genuinely working lead capture and zero way to ever see, export, or act on
 * a single one of those leads. This panel is the missing read side.
 *
 * Chrome: reuses the same `.m-live-card`/`.st`/`.m-chip`/`.m-task-*` classes
 * GrowthPanel/AutoModePanel already established.
 */

import { useCallback, useEffect, useState } from 'react'

interface Props {
  companyId: string
}

interface WaitlistEntry {
  email: string
  joinedAt: string
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`
  return value
}

export function WaitlistPanel({ companyId }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [entries, setEntries] = useState<WaitlistEntry[]>([])

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/build/waitlist?slug=${encodeURIComponent(companyId)}`)
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
    const header = 'email,joinedAt'
    const rows = entries.map((e) => `${csvEscape(e.email)},${csvEscape(e.joinedAt)}`)
    const csv = [header, ...rows].join('\n')
    const blob = new Blob([csv], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `${companyId}-waitlist.csv`
    document.body.appendChild(a)
    a.click()
    a.remove()
    URL.revokeObjectURL(url)
  }, [entries, companyId])

  if (!loaded) return null

  return (
    <div className="m-live-card" data-testid="waitlist-panel">
      <div className="m-task-card-h">
        <span className="st">Waitlist</span>
        <span className="m-chip" data-testid="waitlist-count">
          {entries.length} signup{entries.length === 1 ? '' : 's'}
        </span>
      </div>

      {entries.length === 0 ? (
        <p className="m-mono m-metric-note" data-testid="waitlist-empty">
          No signups yet — real emails from your landing page's waitlist form will show up here.
        </p>
      ) : (
        <>
          <div className="m-task-card" data-testid="waitlist-list">
            {entries.slice(0, 20).map((e, i) => (
              <div className="m-task-card-h" key={`${e.email}-${i}`}>
                <span className="m-mono" data-testid="waitlist-email">{e.email}</span>
                <span className="m-task-meta" data-testid="waitlist-joined-at">
                  {new Date(e.joinedAt).toLocaleDateString()}
                </span>
              </div>
            ))}
          </div>
          {entries.length > 20 && (
            <p className="m-mono m-metric-note">+{entries.length - 20} more — export CSV to see all.</p>
          )}
          <button className="btn-secondary" data-testid="waitlist-export" onClick={downloadCsv}>
            Export CSV
          </button>
        </>
      )}
    </div>
  )
}

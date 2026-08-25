'use client'

/**
 * VersionsPanel (#62) — per-company deploy version history + one-click rollback
 * on the Live dashboard.
 *
 * Lists every deploy of the company app as a version (commit-style message + git
 * SHA + timestamp), with a CURRENT badge on the live one, newest-first. Each prior
 * version has a REVERT action that rolls the live site back to that deployment via
 * Railway (redeploy) — with a confirmation first (destructive-ish: it changes the
 * live site) and honest status states (rolling back → validating → live), only
 * declaring "live" once the rolled-back site is health-verified.
 *
 * Data comes from /api/build/versions:
 *   GET  → { versions, serviced }   (Railway history JOINed with our version index)
 *   POST → { ok, status, healthy }  (trigger + health-check a rollback)
 *
 * Chrome: reuses the `.modernist` `.m-live-card`, `.st` status pills, and `.m-chip`
 * classes already used by the dashboard (and the Tasks panel), so it matches the
 * #67 systems grid + #55 Tasks panel without a new visual language. Honest empty
 * state: a company with a single deploy shows "v1 · current" — no fake history.
 */

import { useCallback, useEffect, useState } from 'react'

/** A version as returned by /api/build/versions (mirrors version-store AppVersion). */
interface AppVersion {
  deploymentId: string
  status: 'live' | 'success' | 'building' | 'failed' | 'removed'
  message: string
  commitSha?: string
  createdAt?: string
  current: boolean
  canRollback: boolean
}

/** Map a version status to the `.st` pill modifier so badges match the dashboard. */
function statusStClass(v: AppVersion): string {
  if (v.current) return 'is-done'
  switch (v.status) {
    case 'building':
      return 'is-running'
    case 'failed':
    case 'removed':
      return 'is-needs'
    default:
      return '' // prior success — neutral pill
  }
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

/** Honest rollback lifecycle for the UI status line. */
type RollbackState =
  | { phase: 'idle' }
  | { phase: 'confirm'; version: AppVersion }
  | { phase: 'rolling_back'; deploymentId: string }
  | { phase: 'validating'; deploymentId: string }
  | { phase: 'live'; deploymentId: string }
  | { phase: 'error'; message: string }

export function VersionsPanel({ companyId }: { companyId: string }) {
  const [versions, setVersions] = useState<AppVersion[]>([])
  const [loaded, setLoaded] = useState(false)
  const [serviced, setServiced] = useState(false)
  const [rollback, setRollback] = useState<RollbackState>({ phase: 'idle' })

  const load = useCallback(() => {
    let alive = true
    fetch(`/api/build/versions?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setVersions(Array.isArray(d?.versions) ? d.versions : [])
        setServiced(!!d?.serviced)
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  // Hydrate on mount / company change (#62) — an honest single "v1" for a
  // brand-new company, real history otherwise. Never fabricated.
  useEffect(() => load(), [load])

  // Ask for confirmation before a rollback (destructive-ish — changes live site).
  const requestRollback = (v: AppVersion) => setRollback({ phase: 'confirm', version: v })
  const cancelRollback = () => setRollback({ phase: 'idle' })

  // Confirmed: trigger the Railway rollback, then reflect honest status. We do not
  // show "live" until the server reports the rolled-back site is health-verified.
  const confirmRollback = async (v: AppVersion) => {
    setRollback({ phase: 'rolling_back', deploymentId: v.deploymentId })
    try {
      const res = await fetch('/api/build/versions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, deploymentId: v.deploymentId }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) {
        setRollback({ phase: 'error', message: d?.error || 'Rollback failed — try again.' })
        return
      }
      if (d.status === 'live' && d.healthy) {
        setRollback({ phase: 'live', deploymentId: v.deploymentId })
        load() // refresh so the CURRENT badge moves to the rolled-back version
      } else {
        // Redeploy accepted but not yet healthy → validating; keep polling.
        setRollback({ phase: 'validating', deploymentId: v.deploymentId })
        pollUntilLive(v.deploymentId)
      }
    } catch {
      setRollback({ phase: 'error', message: 'Connection hiccup — try the rollback again.' })
    }
  }

  // Poll GET a few times so the CURRENT badge moves once the rolled-back deploy is
  // serving. Honest: stays in "validating" until Railway reports it live.
  const pollUntilLive = useCallback(
    (deploymentId: string) => {
      let attempts = 0
      const tick = () => {
        attempts += 1
        fetch(`/api/build/versions?companyId=${encodeURIComponent(companyId)}`)
          .then((r) => (r.ok ? r.json() : null))
          .then((d) => {
            const vs: AppVersion[] = Array.isArray(d?.versions) ? d.versions : []
            setVersions(vs)
            const nowLive = vs.find((x) => x.deploymentId === deploymentId && x.current)
            if (nowLive) {
              setRollback({ phase: 'live', deploymentId })
            } else if (attempts < 10) {
              setTimeout(tick, 6000)
            } else {
              // Give up polling but stay honest — it's still validating, not failed.
              setRollback({ phase: 'validating', deploymentId })
            }
          })
          .catch(() => { if (attempts < 10) setTimeout(tick, 6000) })
      }
      setTimeout(tick, 6000)
    },
    [companyId],
  )

  const rollingId =
    rollback.phase === 'rolling_back' || rollback.phase === 'validating' || rollback.phase === 'live'
      ? rollback.deploymentId
      : null

  return (
    <div className="m-live-card" data-testid="versions-panel">
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">◇</span> Versions &amp; rollback
      </div>

      {/* Honest rollback status line — rolling back → validating → live. */}
      {rollback.phase === 'rolling_back' && (
        <p className="m-mono m-ver-status is-running" data-testid="rollback-status">
          Rolling back…
        </p>
      )}
      {rollback.phase === 'validating' && (
        <p className="m-mono m-ver-status is-running" data-testid="rollback-status">
          Validating the rolled-back site…
        </p>
      )}
      {rollback.phase === 'live' && (
        <p className="m-mono m-ver-status is-live" data-testid="rollback-status">
          ✓ Rolled back — your site is live on this version.
        </p>
      )}
      {rollback.phase === 'error' && (
        <p className="m-mono m-ver-status is-error" data-testid="rollback-status">
          {rollback.message}
        </p>
      )}

      {/* Body: loading → honest single-version / empty → the version list. */}
      {!loaded ? (
        <p className="m-mono m-task-empty" data-testid="versions-loading">loading versions…</p>
      ) : versions.length === 0 ? (
        <p className="m-mono m-task-empty" data-testid="versions-empty">
          No deploy history yet. As Cody ships changes to {companyId ? 'your company' : 'this company'},
          each deploy appears here as a version you can roll back to.
        </p>
      ) : (
        <>
          {!serviced && (
            <p className="m-mono m-task-empty" data-testid="versions-single-note">
              This is your first version. Once your company has its own deploy pipeline, every
              change Cody ships becomes a version you can revert to.
            </p>
          )}
          <ul className="m-task-list" data-testid="versions-list">
            {versions.map((v) => (
              <li
                key={v.deploymentId}
                className="m-task-card"
                data-testid="version-card"
                data-status={v.status}
              >
                <div className="m-task-card-top">
                  <span className={`st ${statusStClass(v)}`} data-testid="version-status-badge">
                    {v.current ? 'CURRENT' : v.status}
                  </span>
                  {v.commitSha && (
                    <span className="m-chip m-ver-sha" data-testid="version-sha">{v.commitSha}</span>
                  )}
                </div>
                <p className="m-task-title" data-testid="version-message">{v.message}</p>
                <div className="m-task-card-foot m-mono">
                  <span className="m-task-meta">{ago(v.createdAt)}</span>
                  {v.canRollback ? (
                    <button
                      className="btn-ghost m-task-view"
                      data-testid="version-revert"
                      disabled={rollingId != null}
                      onClick={() => requestRollback(v)}
                    >
                      REVERT →
                    </button>
                  ) : v.current ? (
                    <span className="m-mono m-ver-live-tag" data-testid="version-live-tag">live</span>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      {/* Confirmation before a rollback (#62 req 4) — destructive-ish. */}
      {rollback.phase === 'confirm' && (
        <div
          className="m-task-detail"
          role="dialog"
          aria-label="Confirm rollback"
          data-testid="rollback-confirm"
        >
          <div className="m-task-detail-head">
            <span className="st is-needs">Confirm rollback</span>
            <button
              className="btn-ghost m-task-detail-close"
              data-testid="rollback-cancel"
              onClick={cancelRollback}
            >
              cancel ✕
            </button>
          </div>
          <p className="m-task-detail-body">
            Roll your live site back to <strong>{rollback.version.message}</strong>
            {rollback.version.commitSha ? ` (${rollback.version.commitSha})` : ''}? This redeploys that
            earlier version and replaces what&apos;s live now. Rolling back validates your live site.
          </p>
          <div className="m-infra-btns">
            <button
              className="btn-primary"
              data-testid="rollback-confirm-btn"
              onClick={() => confirmRollback(rollback.version)}
            >
              Roll back →
            </button>
            <button className="btn-secondary" data-testid="rollback-cancel-btn" onClick={cancelRollback}>
              Keep current version
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

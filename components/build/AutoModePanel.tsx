'use client'

/**
 * AutoModePanel (#58) — "Cody works nonstop. You choose how long."
 *
 * The founder picks a bounded window (1h / 4h / 8h / overnight / continuous) and
 * hits START AUTO MODE. That fires a real user-initiated autonomous run: the swarm
 * is dispatched across the chosen window (via the same loop the nightly cron drives),
 * and this panel shows live progress — time remaining, tasks dispatched this run,
 * and the current activity. STOP ends it.
 *
 * Machine surface: /api/build/auto-mode (also agent-triggerable, #58 req 4).
 * Gating (#58 req 5): the run is a paid capability (Business+, same unlock as the
 * nightly loop); credit cost is shown transparently before starting. When the loop
 * store isn't configured the panel renders an honest disabled state and never fakes
 * a run.
 *
 * Chrome: reuses the `.modernist` `.m-live-card`, `.st` pills, `.m-chip`, `.btn-*`,
 * `.m-doc-tab` and `.m-task-*` classes already used by #54/#55/#62/#64 so it matches
 * the dashboard without introducing a new visual language. A NEW, distinct section —
 * does not touch #65/#67/#55/#62/#52/#64/#51/#54.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  AUTO_DURATIONS,
  DURATION_LABELS,
  creditCostLabel,
  runProgress,
  type AutoDuration,
  type AutoRun,
} from '@/lib/build/auto-mode'

interface AutoModeApi {
  configured: boolean
  run: AutoRun | null
  durations: { id: AutoDuration; label: string; cost: string }[]
}

interface Props {
  companyId: string
  companyName: string
  track?: 'app' | 'company'
  /** Whether Auto Mode is unlocked on the current plan (Business+). */
  unlocked: boolean
  /** Called when a locked founder tries to start — routes to upgrade. */
  onUpgrade: () => void
}

export function AutoModePanel({ companyId, companyName, track = 'company', unlocked, onUpgrade }: Props) {
  const [loaded, setLoaded] = useState(false)
  const [configured, setConfigured] = useState(true)
  const [run, setRun] = useState<AutoRun | null>(null)
  const [duration, setDuration] = useState<AutoDuration>('4h')
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  // A ticking clock so the countdown re-renders every second without refetching.
  const [nowMs, setNowMs] = useState(() => Date.now())

  const load = useCallback(() => {
    let alive = true
    fetch(`/api/build/auto-mode?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d: AutoModeApi | null) => {
        if (!alive) return
        setConfigured(d?.configured !== false)
        setRun(d?.run ?? null)
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  useEffect(() => load(), [load])

  // Live countdown tick (1s) while a run is active — cheap, no network.
  const progress = runProgress(run, nowMs)
  useEffect(() => {
    if (!progress.running) return
    const t = setInterval(() => setNowMs(Date.now()), 1000)
    return () => clearInterval(t)
  }, [progress.running])

  const start = async () => {
    if (busy) return
    if (!unlocked) { onUpgrade(); return }
    setBusy(true); setNotice(null)
    try {
      const r = await fetch('/api/build/auto-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, companyName, track, duration, action: 'start' }),
      })
      const d = await r.json().catch(() => null)
      if (d?.ok && d.run) {
        setRun(d.run as AutoRun)
        setNowMs(Date.now())
        setNotice(`Auto Mode on — Cody is running ${companyName} for ${DURATION_LABELS[duration]}.`)
      } else if (d?.reason === 'not_paid') {
        onUpgrade()
      } else if (d?.reason === 'unverified') {
        // Real bug fix: a transient core hiccup used to look identical to
        // "not paid" and silently bounced a real paying founder to checkout.
        // Never redirect here — this is a retryable verification failure,
        // not a confirmed entitlement gap.
        setNotice('Could not verify your plan just now — try again in a moment.')
      } else if (d?.reason === 'unavailable') {
        setConfigured(false)
        setNotice('Auto Mode isn’t available in this environment yet.')
      } else {
        setNotice('Could not start Auto Mode — try again in a moment.')
      }
    } catch {
      setNotice('Could not start Auto Mode — try again in a moment.')
    } finally {
      setBusy(false)
    }
  }

  const stop = async () => {
    if (busy) return
    setBusy(true); setNotice(null)
    try {
      const r = await fetch('/api/build/auto-mode', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, companyName, track, action: 'stop' }),
      })
      const d = await r.json().catch(() => null)
      setRun((d?.run as AutoRun) ?? null)
      setNotice('Auto Mode stopped.')
    } catch {
      setNotice('Could not stop Auto Mode — try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="m-live-card" data-testid="auto-mode-panel">
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">◇</span> Auto Mode
        <span
          className={`st ${progress.running ? 'is-running' : 'is-planned'}`}
          data-testid="auto-mode-status"
          style={{ marginLeft: 8 }}
        >
          {progress.running ? 'running' : 'off'}
        </span>
      </div>

      <p className="m-mono m-metric-note" data-testid="auto-mode-tagline">
        Cody works nonstop. You choose how long.
      </p>

      {!loaded ? (
        <p className="m-mono m-task-empty" data-testid="auto-mode-loading">loading…</p>
      ) : !configured ? (
        <p className="m-mono m-metric-note" data-testid="auto-mode-disabled-note">
          Auto Mode isn’t available in this environment yet. Nothing was faked — it’ll switch on
          once the autonomous loop is configured for {companyName}.
        </p>
      ) : progress.running ? (
        // ---- RUNNING: live progress ----------------------------------------
        <div className="m-task-card" data-testid="auto-mode-running">
          <div className="m-task-card-h">
            <span className="st is-running" data-testid="auto-mode-duration">
              {run ? DURATION_LABELS[run.duration] : 'running'}
            </span>
            <span className="m-chip" data-testid="auto-mode-time-remaining">
              {progress.timeLeftLabel === 'running' ? 'continuous' : `${progress.timeLeftLabel} left`}
            </span>
          </div>
          <p className="m-task-meta" data-testid="auto-mode-tasks-dispatched">
            {progress.dispatchesSoFar} task{progress.dispatchesSoFar === 1 ? '' : 's'} dispatched this run
          </p>
          <p className="m-task-meta" data-testid="auto-mode-activity">
            Current activity: Cody is dispatching the swarm on {companyName} — briefing → highest-leverage task → ship.
          </p>
          <button
            className="btn-secondary"
            data-testid="auto-mode-stop"
            onClick={stop}
            disabled={busy}
          >
            {busy ? 'Stopping…' : 'STOP'}
          </button>
        </div>
      ) : (
        // ---- IDLE: duration selector + start -------------------------------
        <div className="m-task-card" data-testid="auto-mode-idle">
          <label className="m-mono m-metric-note" htmlFor="auto-mode-duration-select">
            Run autonomously for:
          </label>
          <div className="m-doc-tabs" role="radiogroup" aria-label="Auto Mode duration" data-testid="auto-mode-durations">
            {AUTO_DURATIONS.map((d) => (
              <button
                key={d}
                role="radio"
                aria-checked={duration === d}
                className={`m-chip m-doc-tab${duration === d ? ' is-active' : ''}`}
                data-testid={`auto-mode-duration-${d}`}
                onClick={() => setDuration(d)}
              >
                {DURATION_LABELS[d]}
              </button>
            ))}
          </div>
          {/* Native select mirror for accessibility + simple E2E selection. */}
          <select
            id="auto-mode-duration-select"
            className="m-select"
            data-testid="auto-mode-duration-select"
            value={duration}
            onChange={(e) => setDuration(e.target.value as AutoDuration)}
            style={{ display: 'none' }}
          >
            {AUTO_DURATIONS.map((d) => (
              <option key={d} value={d}>{DURATION_LABELS[d]}</option>
            ))}
          </select>

          <p className="m-mono m-metric-note" data-testid="auto-mode-cost">
            {creditCostLabel(duration)} · {unlocked ? 'included on your plan' : 'Business plan required'}
          </p>

          <button
            className="btn-primary"
            data-testid="auto-mode-start"
            onClick={start}
            disabled={busy}
          >
            {busy ? 'Starting…' : unlocked ? 'START AUTO MODE' : 'START AUTO MODE ↗'}
          </button>
        </div>
      )}

      {notice && (
        <p className="m-mono m-ver-status" data-testid="auto-mode-notice">{notice}</p>
      )}
    </div>
  )
}

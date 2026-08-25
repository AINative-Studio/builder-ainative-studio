'use client'

/**
 * DangerZone (#57) — pause the company (stop the nightly loop), take its app
 * offline, or delete it, with confirmation. Posts to /api/build/danger, which maps
 * these to the real state stores (loop-enrollment + app-registry lifecycle).
 *
 * Authenticated founders only (rendered from Account.tsx's authenticated branch).
 * Destructive actions (offline, delete) require the founder to type the company
 * name to confirm — the same guard the server re-checks. Pause is reversible and
 * doesn't require typed confirmation, just a click.
 *
 * If there's no active company in context, the zone shows an honest "build or open
 * a company first" note instead of dangerous no-op buttons.
 */

import { useState } from 'react'

interface DangerZoneProps {
  companyId: string
  companyName: string
  slug: string
  track: 'app' | 'company'
}

type PendingAction = 'offline' | 'delete' | null

export function DangerZone({ companyId, companyName, slug, track }: DangerZoneProps) {
  const [pending, setPending] = useState<PendingAction>(null)
  const [confirmText, setConfirmText] = useState('')
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; msg: string } | null>(null)

  const hasCompany = Boolean(companyId && companyName)

  const post = async (action: 'pause' | 'offline' | 'delete', confirm?: string) => {
    if (busy) return
    setBusy(true)
    setResult(null)
    try {
      const r = await fetch('/api/build/danger', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, companyId, companyName, slug, track, confirm }),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.ok) {
        setResult({ ok: true, msg: labelFor(action) })
        setPending(null)
        setConfirmText('')
      } else {
        setResult({ ok: false, msg: (d && d.error) || 'Action failed.' })
      }
    } catch {
      setResult({ ok: false, msg: 'Action failed. Please try again.' })
    } finally {
      setBusy(false)
    }
  }

  const confirmMatches = confirmText.trim().toLowerCase() === companyName.trim().toLowerCase()

  return (
    <section className="m-account-sec m-danger" data-testid="account-danger-section">
      <h2 className="m-mono m-account-sec-h m-danger-h">Danger zone</h2>

      {!hasCompany ? (
        <p className="m-mono m-muted" data-testid="danger-no-company">
          Build or open a company to manage its loop and deployment here.
        </p>
      ) : (
        <div className="m-sec-rows">
          {/* Pause — reversible, one click. */}
          <div className="m-sec-row">
            <span>Pause the company<br /><span className="m-mono m-muted">Stops the nightly autonomous loop.</span></span>
            <button
              className="btn-secondary"
              data-testid="danger-pause"
              disabled={busy}
              onClick={() => post('pause')}
            >
              Pause loop
            </button>
          </div>

          {/* Take offline — destructive, needs typed confirmation. */}
          <div className="m-sec-row">
            <span>Take the app offline<br /><span className="m-mono m-muted">Keeps the company, stops serving the app.</span></span>
            <button
              className="btn-danger"
              data-testid="danger-offline"
              disabled={busy}
              onClick={() => { setPending(pending === 'offline' ? null : 'offline'); setConfirmText(''); setResult(null) }}
            >
              Take offline
            </button>
          </div>

          {/* Delete — most destructive, needs typed confirmation. */}
          <div className="m-sec-row">
            <span>Delete the company<br /><span className="m-mono m-muted">Removes it and stops the loop. This can't be undone.</span></span>
            <button
              className="btn-danger"
              data-testid="danger-delete"
              disabled={busy}
              onClick={() => { setPending(pending === 'delete' ? null : 'delete'); setConfirmText(''); setResult(null) }}
            >
              Delete company
            </button>
          </div>

          {/* Confirmation prompt for the two destructive actions. */}
          {pending && (
            <div className="m-danger-confirm" data-testid="danger-confirm">
              <label className="m-field-l" htmlFor="danger-confirm-input">
                Type <strong>{companyName}</strong> to {pending === 'delete' ? 'delete' : 'take offline'}
              </label>
              <input
                id="danger-confirm-input"
                data-testid="danger-confirm-input"
                type="text"
                value={confirmText}
                onChange={(e) => setConfirmText(e.target.value)}
                autoComplete="off"
              />
              <div className="m-settings-actions">
                <button
                  className="btn-danger"
                  data-testid="danger-confirm-submit"
                  disabled={busy || !confirmMatches}
                  onClick={() => post(pending, confirmText.trim())}
                >
                  {busy ? 'Working…' : pending === 'delete' ? 'Delete permanently' : 'Take offline'}
                </button>
                <button
                  className="btn-ghost"
                  data-testid="danger-confirm-cancel"
                  disabled={busy}
                  onClick={() => { setPending(null); setConfirmText('') }}
                >
                  Cancel
                </button>
              </div>
            </div>
          )}

          {result && (
            <p
              className={`m-mono ${result.ok ? 'is-done' : 'is-err'}`}
              data-testid={result.ok ? 'danger-result-ok' : 'danger-result-err'}
            >
              {result.msg}
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function labelFor(action: 'pause' | 'offline' | 'delete'): string {
  switch (action) {
    case 'pause':
      return 'Loop paused. The company will not run overnight.'
    case 'offline':
      return 'App taken offline. The company is kept but not served.'
    case 'delete':
      return 'Company deleted.'
  }
}

'use client'

/**
 * WebsitePanel (#63) — the Website / App management panel on the Live dashboard.
 *
 * Consolidates the NEW app-management operations (Manage Domain #53, Versions #62
 * and Tasks #55 live in their own panels — linked, not duplicated):
 *
 *   A. Redeploy — rebuild/re-run the CURRENT version so changes take effect, with
 *      an honest "redeploying → validating → live" status + health check. Confirmed
 *      first (it changes the live site). This finishes the old disabled
 *      "Redeploy · soon" placeholder.
 *   B. Secrets — view/add/edit/delete the env vars the deployed app reads at
 *      runtime. Values are ALWAYS masked; platform-reserved vars are read-only.
 *      Owner-only (real auth).
 *   C. Database Download — export the company's OWN ZeroDB data as JSON or CSV.
 *      Reinforces "you own 100%, take your data anytime."
 *
 * Chrome: reuses the `.modernist` `.m-live-card`, `.st` pills, `.m-chip`,
 * `.m-task-*` and `.m-infra-btns` classes already used by the Versions / Tasks
 * panels so it matches the existing dashboard without a new visual language.
 *
 * All actions are honest + owner-gated by the server; the UI degrades gracefully
 * when the company has no dedicated deploy service yet (unpaid / not provisioned).
 */

import { useCallback, useEffect, useState } from 'react'

/** A masked runtime secret as returned by /api/build/secrets. */
interface MaskedSecret {
  name: string
  masked: string
  reserved: boolean
}

/** Honest redeploy lifecycle for the status line. */
type RedeployState =
  | { phase: 'idle' }
  | { phase: 'confirm' }
  | { phase: 'redeploying' }
  | { phase: 'validating' }
  | { phase: 'live' }
  | { phase: 'error'; message: string }

export function WebsitePanel({
  companyId,
  canManage,
  onRequireUpgrade,
}: {
  companyId: string
  /** True when the founder is on a paid plan and owns the company (owner-only ops). */
  canManage: boolean
  /** Called when an owner-only action is attempted without a paid plan. */
  onRequireUpgrade?: () => void
}) {
  // ---- Redeploy (A) ----
  const [redeploy, setRedeploy] = useState<RedeployState>({ phase: 'idle' })

  // ---- Secrets (B) ----
  const [secrets, setSecrets] = useState<MaskedSecret[]>([])
  const [secretsLoaded, setSecretsLoaded] = useState(false)
  const [secretsAvailable, setSecretsAvailable] = useState(false)
  const [newName, setNewName] = useState('')
  const [newValue, setNewValue] = useState('')
  const [secretBusy, setSecretBusy] = useState(false)
  const [secretError, setSecretError] = useState<string | null>(null)

  // ---- Export (C) ----
  const [exporting, setExporting] = useState<'json' | 'csv' | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)

  const loadSecrets = useCallback(() => {
    if (!canManage) { setSecretsLoaded(true); return }
    let alive = true
    fetch(`/api/build/secrets?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive) return
        setSecrets(Array.isArray(d?.secrets) ? d.secrets : [])
        setSecretsAvailable(!!d?.available)
        setSecretsLoaded(true)
      })
      .catch(() => { if (alive) setSecretsLoaded(true) })
    return () => { alive = false }
  }, [companyId, canManage])

  useEffect(() => loadSecrets(), [loadSecrets])

  // ---- Redeploy actions ----
  const requestRedeploy = () => {
    if (!canManage) { onRequireUpgrade?.(); return }
    setRedeploy({ phase: 'confirm' })
  }
  const cancelRedeploy = () => setRedeploy({ phase: 'idle' })

  const confirmRedeploy = async () => {
    setRedeploy({ phase: 'redeploying' })
    try {
      const res = await fetch('/api/build/redeploy', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) {
        setRedeploy({ phase: 'error', message: d?.error || 'Redeploy failed — try again.' })
        return
      }
      if (d.status === 'live' && d.healthy) {
        setRedeploy({ phase: 'live' })
      } else {
        // Accepted but not yet healthy → validating.
        setRedeploy({ phase: 'validating' })
      }
    } catch {
      setRedeploy({ phase: 'error', message: 'Connection hiccup — try the redeploy again.' })
    }
  }

  // ---- Secret actions ----
  const addSecret = async () => {
    if (!canManage) { onRequireUpgrade?.(); return }
    const name = newName.trim()
    if (!name || secretBusy) return
    setSecretBusy(true)
    setSecretError(null)
    try {
      const res = await fetch('/api/build/secrets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, name, value: newValue }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) {
        setSecretError(d?.error || 'Could not save that secret.')
        return
      }
      setNewName('')
      setNewValue('')
      loadSecrets()
    } catch {
      setSecretError('Connection hiccup — try again.')
    } finally {
      setSecretBusy(false)
    }
  }

  const deleteSecret = async (name: string) => {
    if (!canManage || secretBusy) return
    setSecretBusy(true)
    setSecretError(null)
    try {
      const res = await fetch('/api/build/secrets', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, name }),
      })
      const d = await res.json().catch(() => null)
      if (!res.ok || !d?.ok) {
        setSecretError(d?.error || 'Could not delete that secret.')
        return
      }
      loadSecrets()
    } catch {
      setSecretError('Connection hiccup — try again.')
    } finally {
      setSecretBusy(false)
    }
  }

  // ---- Export action ----
  const exportData = async (format: 'json' | 'csv') => {
    if (!canManage) { onRequireUpgrade?.(); return }
    if (exporting) return
    setExporting(format)
    setExportError(null)
    try {
      const res = await fetch(`/api/build/export?companyId=${encodeURIComponent(companyId)}&format=${format}`)
      if (!res.ok) {
        const d = await res.json().catch(() => null)
        setExportError(d?.error || 'Export unavailable right now.')
        return
      }
      // Turn the attachment into a real browser download.
      const blob = await res.blob()
      const cd = res.headers.get('Content-Disposition') || ''
      const m = /filename="?([^"]+)"?/.exec(cd)
      const filename = m ? m[1] : `${companyId}-data.${format === 'csv' ? 'csv' : 'json'}`
      const link = document.createElement('a')
      const objectUrl = URL.createObjectURL(blob)
      link.href = objectUrl
      link.download = filename
      document.body.appendChild(link)
      link.click()
      link.remove()
      URL.revokeObjectURL(objectUrl)
    } catch {
      setExportError('Connection hiccup — try the export again.')
    } finally {
      setExporting(null)
    }
  }

  const redeployBusy = redeploy.phase === 'redeploying' || redeploy.phase === 'validating'

  return (
    <div className="m-live-card" data-testid="website-panel">
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">◇</span> Website &amp; app
      </div>

      {/* ---- A. Redeploy ---- */}
      <div className="m-website-section" data-testid="website-redeploy">
        <p className="m-mono m-website-sub">Redeploy the current version so your latest changes take effect.</p>

        {redeploy.phase === 'redeploying' && (
          <p className="m-mono m-ver-status is-running" data-testid="redeploy-status">Redeploying…</p>
        )}
        {redeploy.phase === 'validating' && (
          <p className="m-mono m-ver-status is-running" data-testid="redeploy-status">Validating your live site…</p>
        )}
        {redeploy.phase === 'live' && (
          <p className="m-mono m-ver-status is-live" data-testid="redeploy-status">✓ Redeployed — your site is live.</p>
        )}
        {redeploy.phase === 'error' && (
          <p className="m-mono m-ver-status is-error" data-testid="redeploy-status">{redeploy.message}</p>
        )}

        {redeploy.phase === 'confirm' ? (
          <div className="m-task-detail" role="dialog" aria-label="Confirm redeploy" data-testid="redeploy-confirm">
            <p className="m-task-detail-body">
              Redeploy the current version of your live site? This rebuilds and re-runs your app so recent
              changes take effect. We&apos;ll validate the site is serving before reporting it live.
            </p>
            <div className="m-infra-btns">
              <button className="btn-primary" data-testid="redeploy-confirm-btn" onClick={confirmRedeploy}>
                Redeploy →
              </button>
              <button className="btn-secondary" data-testid="redeploy-cancel-btn" onClick={cancelRedeploy}>
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            className="btn-secondary"
            data-testid="redeploy-btn"
            disabled={redeployBusy}
            onClick={requestRedeploy}
            title={canManage ? 'Redeploy the current version' : 'Upgrade to redeploy your app'}
          >
            {redeployBusy ? 'Redeploying…' : 'Redeploy'}
          </button>
        )}
      </div>

      {/* ---- B. Secrets ---- */}
      <div className="m-website-section" data-testid="website-secrets">
        <div className="m-mono m-website-section-h">Secrets</div>
        <p className="m-mono m-website-sub">
          API keys &amp; credentials your app reads at runtime. Values are hidden — only you (the owner) can manage them.
        </p>

        {!canManage ? (
          // #378: this used to be plain text, same weight as active content, so it
          // didn't read as an upgrade CTA. A real button (matching the existing
          // upgrade-CTA pattern used elsewhere, e.g. "Claim subdomain (upgrade)")
          // makes the paywall obvious instead of looking like an inert placeholder.
          <button className="btn-primary" data-testid="secrets-locked" onClick={onRequireUpgrade}>
            Upgrade to add runtime secrets →
          </button>
        ) : !secretsLoaded ? (
          <p className="m-mono m-task-empty" data-testid="secrets-loading">loading secrets…</p>
        ) : !secretsAvailable && secrets.length === 0 ? (
          <p className="m-mono m-task-empty" data-testid="secrets-unavailable">
            Secrets become available once your app has its own deploy service.
          </p>
        ) : (
          <>
            {secrets.length === 0 ? (
              <p className="m-mono m-task-empty" data-testid="secrets-empty">
                No secrets yet. Add an API key or credential your app needs at runtime.
              </p>
            ) : (
              <ul className="m-task-list" data-testid="secrets-list">
                {secrets.map((s) => (
                  <li key={s.name} className="m-task-card" data-testid="secret-row">
                    <div className="m-task-card-top">
                      <span className="m-chip" data-testid="secret-name">{s.name}</span>
                      {s.reserved && <span className="st is-needs" data-testid="secret-reserved">system</span>}
                    </div>
                    <div className="m-task-card-foot m-mono">
                      <span className="m-task-meta" data-testid="secret-masked">{s.masked || '••••••••'}</span>
                      {!s.reserved && (
                        <button
                          className="btn-ghost m-task-view"
                          data-testid="secret-delete"
                          disabled={secretBusy}
                          onClick={() => deleteSecret(s.name)}
                        >
                          delete ✕
                        </button>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}

            {/* Add / edit a secret. Editing = add with the same name (upsert). */}
            <div className="m-secret-add" data-testid="secret-add">
              <input
                className="m-secret-input"
                data-testid="secret-name-input"
                placeholder="SECRET_NAME"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                aria-label="Secret name"
              />
              <input
                className="m-secret-input"
                data-testid="secret-value-input"
                type="password"
                placeholder="value"
                value={newValue}
                onChange={(e) => setNewValue(e.target.value)}
                aria-label="Secret value"
              />
              <button
                className="btn-secondary"
                data-testid="secret-save"
                disabled={!newName.trim() || secretBusy}
                onClick={addSecret}
              >
                {secretBusy ? 'Saving…' : 'Save'}
              </button>
            </div>
            {secretError && (
              <p className="m-mono m-ver-status is-error" data-testid="secret-error">{secretError}</p>
            )}
          </>
        )}
      </div>

      {/* ---- C. Database download ---- */}
      <div className="m-website-section" data-testid="website-export">
        <div className="m-mono m-website-section-h">Your data</div>
        <p className="m-mono m-website-sub">
          You own 100% of your data. Download a full copy of your company&apos;s database anytime — no lock-in.
        </p>
        <div className="m-infra-btns">
          <button
            className="btn-secondary"
            data-testid="export-json"
            disabled={exporting != null}
            onClick={() => exportData('json')}
            title={canManage ? 'Download your data as JSON' : 'Upgrade to export your data'}
          >
            {exporting === 'json' ? 'Exporting…' : 'Download JSON'}
          </button>
          <button
            className="btn-secondary"
            data-testid="export-csv"
            disabled={exporting != null}
            onClick={() => exportData('csv')}
            title={canManage ? 'Download your data as CSV' : 'Upgrade to export your data'}
          >
            {exporting === 'csv' ? 'Exporting…' : 'Download CSV'}
          </button>
        </div>
        {exportError && (
          <p className="m-mono m-ver-status is-error" data-testid="export-error">{exportError}</p>
        )}
      </div>
    </div>
  )
}

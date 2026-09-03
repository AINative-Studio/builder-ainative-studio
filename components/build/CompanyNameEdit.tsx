'use client'

/**
 * Inline company-name edit (#396) — companyName is auto-generated once from
 * the idea (Intake → /api/build/brand) and was never user-editable until the
 * post-generation dashboard (SettingsForm). Rendered in ArtifactFrame's
 * header on every Company-track artifact from `thesis` onward (the wedge
 * interrupt itself is a full-bleed takeover with no frame chrome, so this
 * can't render DURING wedge — it covers "before" via thesis and "after" via
 * businessModel onward, matching the issue's own "before that step... or
 * edit it in WD-02" ask). Click-to-edit inline; "Regenerate" re-runs the same
 * /api/build/brand call Intake used and takes only the new name — slug/
 * tagline/color are deliberately left untouched (renaming the slug is a much
 * larger operation, out of scope here).
 */

import { useState } from 'react'

export interface CompanyNameEditProps {
  companyName: string
  idea: string
  track: 'app' | 'company'
  /** Only the 30-day-plan step gets the "Regenerate" action per the issue's
   *  exact ask; other views get edit-only. */
  showRegenerate: boolean
  onChange: (name: string) => void
  /** This company's own chatId (#479) — a name-availability hit against this
   *  SAME chatId is the company's own existing name, never a real collision. */
  chatId?: string
}

export function CompanyNameEdit({ companyName, idea, track, showRegenerate, onChange, chatId }: CompanyNameEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(companyName)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')
  const [checking, setChecking] = useState(false)
  // #479: advisory-only — set when save() finds the typed name taken by a
  // DIFFERENT company. Holds the pending name so "Use it anyway" can proceed
  // without re-typing; never blocks, just asks for one confirmation click.
  const [collision, setCollision] = useState<{ name: string; existingName: string } | null>(null)

  const startEdit = () => {
    setDraft(companyName)
    setError('')
    setCollision(null)
    setEditing(true)
  }

  const commit = (name: string) => {
    onChange(name)
    setEditing(false)
    setError('')
    setCollision(null)
  }

  const save = async () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Name can’t be empty.')
      return
    }
    setError('')
    setChecking(true)
    try {
      const res = await fetch('/api/build/name-available', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, chatId }),
      })
      const data = await res.json().catch(() => null)
      if (data && data.available === false) {
        setCollision({ name: trimmed, existingName: data.existingName || trimmed })
        return
      }
    } catch {
      // Fail open — a lookup hiccup must never block the rename.
    } finally {
      setChecking(false)
    }
    commit(trimmed)
  }

  const regenerate = async () => {
    if (regenerating || !idea) return
    setRegenerating(true)
    setError('')
    try {
      const res = await fetch('/api/build/brand', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ idea, track }),
      })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.name) {
        onChange(data.name)
      } else {
        setError('Couldn’t generate a new name — try again.')
      }
    } catch {
      setError('Couldn’t generate a new name — try again.')
    } finally {
      setRegenerating(false)
    }
  }

  if (editing) {
    return (
      <div className="m-company-name-edit" data-testid="company-name-edit">
        <input
          className="m-company-name-input"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            setCollision(null)
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          aria-label="Company name"
          autoFocus
          disabled={checking}
        />
        <button className="btn-ghost m-company-name-action" onClick={save} disabled={checking}>
          {checking ? 'Checking…' : 'Save'}
        </button>
        <button className="btn-ghost m-company-name-action" onClick={() => setEditing(false)}>Cancel</button>
        {error && <p className="m-field-err m-mono">{error}</p>}
        {collision && (
          <p className="m-field-warn m-mono" data-testid="company-name-collision-warning">
            Heads up — a company named &ldquo;{collision.existingName}&rdquo; already exists. You can
            still use &ldquo;{collision.name}&rdquo;, but your link may end up as a numbered variant
            since that name is taken.{' '}
            <button
              className="btn-ghost m-company-name-action"
              data-testid="company-name-use-anyway"
              onClick={() => commit(collision.name)}
            >
              Use it anyway
            </button>
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="m-company-name-display" data-testid="company-name-display">
      <button
        className="m-company-name-label"
        onClick={startEdit}
        title="Click to edit the company name"
        data-testid="company-name-edit-trigger"
      >
        {companyName || 'company'}
      </button>
      {showRegenerate && (
        <button
          className="btn-ghost m-company-name-action"
          disabled={regenerating}
          onClick={regenerate}
          data-testid="company-name-regenerate"
        >
          {regenerating ? 'Regenerating…' : 'Regenerate name'}
        </button>
      )}
      {error && <p className="m-field-err m-mono">{error}</p>}
    </div>
  )
}

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
}

export function CompanyNameEdit({ companyName, idea, track, showRegenerate, onChange }: CompanyNameEditProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(companyName)
  const [regenerating, setRegenerating] = useState(false)
  const [error, setError] = useState('')

  const startEdit = () => {
    setDraft(companyName)
    setError('')
    setEditing(true)
  }

  const save = () => {
    const trimmed = draft.trim()
    if (!trimmed) {
      setError('Name can’t be empty.')
      return
    }
    onChange(trimmed)
    setEditing(false)
    setError('')
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
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') setEditing(false)
          }}
          aria-label="Company name"
          autoFocus
        />
        <button className="btn-ghost m-company-name-action" onClick={save}>Save</button>
        <button className="btn-ghost m-company-name-action" onClick={() => setEditing(false)}>Cancel</button>
        {error && <p className="m-field-err m-mono">{error}</p>}
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

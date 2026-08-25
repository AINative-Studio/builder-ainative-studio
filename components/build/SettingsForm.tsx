'use client'

/**
 * SettingsForm (#57) — editable profile for an AUTHENTICATED founder: full name,
 * email, optional social handle, and content language (the language Cody writes
 * generated artifacts / reports / nightly summaries in). Loads the current values
 * from the real AINative account (GET /api/build/profile) and saves via POST, so
 * changes persist across reload.
 *
 * Guests never see this — Account.tsx renders it only in the authenticated branch
 * (respecting #50's honest guest handling). Matches the .modernist chrome
 * (m-field / m-account-sec / btn-primary).
 */

import { useEffect, useState } from 'react'
import { CONTENT_LANGUAGES, DEFAULT_CONTENT_LANGUAGE } from '@/lib/build/content-language'

interface ProfileShape {
  fullName: string
  email: string
  social: string
  contentLanguage: string
}

const EMPTY: ProfileShape = { fullName: '', email: '', social: '', contentLanguage: DEFAULT_CONTENT_LANGUAGE }

export function SettingsForm({ fallbackName, fallbackEmail }: { fallbackName?: string; fallbackEmail?: string }) {
  const [form, setForm] = useState<ProfileShape>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [status, setStatus] = useState<'idle' | 'saved' | 'error'>('idle')
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({})
  const [errorMsg, setErrorMsg] = useState<string>('')

  // Load the real account profile on mount.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const r = await fetch('/api/build/profile', { method: 'GET' })
        const d = await r.json().catch(() => null)
        if (!cancelled && r.ok && d?.profile) {
          setForm({
            fullName: d.profile.fullName || fallbackName || '',
            email: d.profile.email || fallbackEmail || '',
            social: d.profile.social || '',
            contentLanguage: d.profile.contentLanguage || DEFAULT_CONTENT_LANGUAGE,
          })
        } else if (!cancelled) {
          // Fall back to the session identity so the form isn't blank on a load error.
          setForm({ ...EMPTY, fullName: fallbackName || '', email: fallbackEmail || '' })
        }
      } catch {
        if (!cancelled) setForm({ ...EMPTY, fullName: fallbackName || '', email: fallbackEmail || '' })
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [fallbackName, fallbackEmail])

  const set = (k: keyof ProfileShape) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm((f) => ({ ...f, [k]: e.target.value }))
    setStatus('idle')
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    setFieldErrors({})
    setErrorMsg('')
    setStatus('idle')
    try {
      const r = await fetch('/api/build/profile', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      })
      const d = await r.json().catch(() => null)
      if (r.ok && d?.ok) {
        setStatus('saved')
        if (d.profile) setForm((f) => ({ ...f, ...d.profile }))
      } else {
        setStatus('error')
        if (d?.fields) setFieldErrors(d.fields)
        setErrorMsg(typeof d?.error === 'string' && !d?.fields ? d.error : '')
      }
    } catch {
      setStatus('error')
      setErrorMsg('Could not save. Please try again.')
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="m-account-sec" data-testid="account-settings-section">
      <h2 className="m-mono m-account-sec-h">Profile settings</h2>
      <form className="m-settings-form" onSubmit={save} data-testid="account-settings-form">
        <div className="m-field">
          <label className="m-field-l" htmlFor="settings-name">Full name</label>
          <input
            id="settings-name"
            data-testid="settings-fullname"
            type="text"
            value={form.fullName}
            onChange={set('fullName')}
            disabled={loading}
            autoComplete="name"
          />
          {fieldErrors.fullName && <span className="m-field-err" data-testid="settings-fullname-err">{fieldErrors.fullName}</span>}
        </div>

        <div className="m-field">
          <label className="m-field-l" htmlFor="settings-email">Email</label>
          <input
            id="settings-email"
            data-testid="settings-email"
            type="email"
            value={form.email}
            onChange={set('email')}
            disabled={loading}
            autoComplete="email"
          />
          {fieldErrors.email && <span className="m-field-err" data-testid="settings-email-err">{fieldErrors.email}</span>}
          <span className="m-mono m-muted m-field-hint">Used for reports &amp; notifications. Your sign-in email is managed separately.</span>
        </div>

        <div className="m-field">
          <label className="m-field-l" htmlFor="settings-social">Social handle (optional)</label>
          <input
            id="settings-social"
            data-testid="settings-social"
            type="text"
            value={form.social}
            onChange={set('social')}
            disabled={loading}
            placeholder="@yourhandle"
          />
          {fieldErrors.social && <span className="m-field-err" data-testid="settings-social-err">{fieldErrors.social}</span>}
        </div>

        <div className="m-field">
          <label className="m-field-l" htmlFor="settings-language">Content language</label>
          <select
            id="settings-language"
            data-testid="settings-language"
            className="m-select"
            value={form.contentLanguage}
            onChange={set('contentLanguage')}
            disabled={loading}
          >
            {CONTENT_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>{l.label}</option>
            ))}
          </select>
          <span className="m-mono m-muted m-field-hint">
            Cody writes your artifacts, reports &amp; nightly summaries in this language.
          </span>
        </div>

        <div className="m-settings-actions">
          <button
            type="submit"
            className="btn-primary"
            data-testid="settings-save"
            disabled={saving || loading}
          >
            {saving ? 'Saving…' : 'Save changes'}
          </button>
          {status === 'saved' && <span className="m-settings-status is-done" data-testid="settings-saved">Saved</span>}
          {status === 'error' && (
            <span className="m-settings-status is-err" data-testid="settings-error">
              {errorMsg || 'Please fix the errors above.'}
            </span>
          )}
        </div>
      </form>
    </section>
  )
}

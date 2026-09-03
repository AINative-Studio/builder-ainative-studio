'use client'

/**
 * MediaPanel (#54) — the company's auto-generated ON-BRAND media (image + video) on
 * a recurring schedule, on the Live dashboard.
 *
 * Mirrors Polsia's two parallel modals (Auto Image + Auto Video) in Modernist
 * chrome: each media kind gets a frequency selector (Once / Daily / Weekly /
 * Monthly) and a START AUTO action. Unlike Polsia's black box, generation runs on
 * primitives the company OWNS (core Multimodal + Content-Workflow) and every asset
 * is stored in the company's own ZeroDB/storage. Shows last-generated media + the
 * next scheduled run.
 *
 * Data comes from /api/build/media:
 *   GET  ?companyId=…                          → { routines, assets, configured, nextRuns }
 *   POST { companyId, mediaKind, frequency }   → schedule a routine
 *   POST { companyId, mediaKind, action:'generate', brand } → generate now
 *
 * SAFETY (#54 req 6): when generation isn't configured (creds/flag unset) the panel
 * still renders and scheduling still works (intent captured) — the generate action
 * shows an honest "media generation isn't switched on yet" state instead of failing.
 *
 * Chrome: reuses the `.modernist` `.m-live-card`, `.st` pills, `.m-chip`,
 * `.m-infra-btns`, `.m-task-*` classes already used by the Tasks (#55), Versions
 * (#62) and Documents (#64) panels. A NEW, distinct section — it does NOT touch the
 * #67 systems grid, #52 chat, #55 Tasks, #62 Versions, #64 Documents, #65 masthead
 * or #51 OnboardingVideo sections.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import { validateUpload, isUploadedAsset, UPLOAD_ACCEPT_ATTR } from '@/lib/build/media-upload'

type MediaKind = 'image' | 'video'
type MediaFrequency = 'once' | 'daily' | 'weekly' | 'monthly'

interface Routine {
  id: string
  mediaKind: MediaKind
  frequency: MediaFrequency
  enabled: boolean
  createdAt: string
  lastRunAt?: string
}
interface Asset {
  id: string
  mediaKind: MediaKind
  url: string
  prompt: string
  createdAt: string
  /** 'upload' marks a founder-uploaded photo; anything else is Cody-generated. */
  provider?: string
}

const FREQUENCIES: { key: MediaFrequency; label: string }[] = [
  { key: 'once', label: 'Once' },
  { key: 'daily', label: 'Daily' },
  { key: 'weekly', label: 'Weekly' },
  { key: 'monthly', label: 'Monthly' },
]

const KINDS: { key: MediaKind; title: string; blurb: string }[] = [
  { key: 'image', title: 'Auto Image', blurb: 'Cody creates on-brand images for your business.' },
  { key: 'video', title: 'Auto Video', blurb: 'Cody creates on-brand videos for your business.' },
]

/** Compact "x ago" / date for meta lines. */
function fmtDate(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  const s = Math.max(0, Math.round((Date.now() - t) / 1000))
  if (s < 60) return 'just now'
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/** Human next-run: "due now" when at/before now, else the date. */
function fmtNext(iso?: string | null): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return ''
  if (t <= Date.now()) return 'due now'
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

export function MediaPanel({
  companyId,
  companyName,
  brandTagline,
  brandColor,
  idea,
}: {
  companyId: string
  companyName?: string
  brandTagline?: string
  brandColor?: string
  idea?: string
}) {
  const [routines, setRoutines] = useState<Routine[]>([])
  const [assets, setAssets] = useState<Asset[]>([])
  const [configured, setConfigured] = useState(false)
  const [nextRuns, setNextRuns] = useState<Record<string, string | null>>({})
  const [loaded, setLoaded] = useState(false)
  // Per-kind selected frequency (before START), busy flags and per-kind notices.
  const [freq, setFreq] = useState<Record<MediaKind, MediaFrequency>>({ image: 'weekly', video: 'weekly' })
  const [busy, setBusy] = useState<string | null>(null)
  const [notice, setNotice] = useState<Record<MediaKind, string>>({ image: '', video: '' })
  // Upload-your-own (#323 / GR-14) — file input + per-upload notice.
  const fileInputRef = useRef<HTMLInputElement>(null)
  const [uploadNotice, setUploadNotice] = useState('')

  const load = useCallback(() => {
    let alive = true
    fetch(`/api/build/media?companyId=${encodeURIComponent(companyId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!alive || !d) { if (alive) setLoaded(true); return }
        setRoutines(Array.isArray(d.routines) ? d.routines : [])
        setAssets(Array.isArray(d.assets) ? d.assets : [])
        setConfigured(Boolean(d.configured))
        setNextRuns(d.nextRuns || {})
        // Reflect any persisted frequency back into the selectors.
        const next: Record<MediaKind, MediaFrequency> = { image: 'weekly', video: 'weekly' }
        for (const r of (d.routines || []) as Routine[]) next[r.mediaKind] = r.frequency
        setFreq(next)
        setLoaded(true)
      })
      .catch(() => { if (alive) setLoaded(true) })
    return () => { alive = false }
  }, [companyId])

  useEffect(() => load(), [load])

  const routineFor = (k: MediaKind) => routines.find((r) => r.mediaKind === k)
  // "Last generated" for the auto sections means Cody's output — uploads don't count.
  const latestAsset = (k: MediaKind) => assets.find((a) => a.mediaKind === k && !isUploadedAsset(a))

  // START AUTO — persist the routine (intent captured even if generation is off),
  // then, when configured, immediately kick a first on-brand generation.
  const start = async (k: MediaKind) => {
    setNotice((n) => ({ ...n, [k]: '' }))
    setBusy(`schedule-${k}`)
    try {
      const res = await fetch('/api/build/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyId, mediaKind: k, frequency: freq[k], action: 'schedule' }),
      })
      if (!res.ok) {
        setNotice((n) => ({ ...n, [k]: 'Could not save the schedule — try again shortly.' }))
        return
      }
      const d = await res.json().catch(() => null)
      load()
      if (d && d.configured === false) {
        setNotice((n) => ({ ...n, [k]: `Schedule saved. On-brand ${k} generation switches on once media is enabled.` }))
      } else {
        // Configured: fire an immediate first generation so the founder sees output.
        generate(k)
      }
    } catch {
      setNotice((n) => ({ ...n, [k]: 'Connection hiccup — try again.' }))
    } finally {
      setBusy(null)
    }
  }

  // Generate one on-brand asset now (honest 'disabled' when not configured).
  const generate = async (k: MediaKind) => {
    setNotice((n) => ({ ...n, [k]: '' }))
    setBusy(`generate-${k}`)
    try {
      const res = await fetch('/api/build/media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          companyId, mediaKind: k, action: 'generate',
          brand: { companyName, tagline: brandTagline, color: brandColor, idea },
        }),
      })
      const d = await res.json().catch(() => null)
      if (d?.status === 'generated') { load(); return }
      if (d?.status === 'disabled') {
        setNotice((n) => ({ ...n, [k]: 'Media generation isn’t switched on yet — your schedule is saved and will run once it is.' }))
      } else {
        setNotice((n) => ({ ...n, [k]: `Couldn’t generate ${k} right now — try again shortly.` }))
      }
    } catch {
      setNotice((n) => ({ ...n, [k]: 'Connection hiccup — try again.' }))
    } finally {
      setBusy(null)
    }
  }

  // Upload your own photo (#323 / GR-14): validate client-side with the SAME pure
  // rules the server enforces (images only, ≤5MB), then POST the multipart form.
  const onUploadChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = '' // allow re-picking the same file
    if (!file) return
    setUploadNotice('')
    const verdict = validateUpload({ name: file.name, type: file.type, size: file.size })
    if (!verdict.ok) { setUploadNotice(verdict.message); return }
    setBusy('upload')
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('companyId', companyId)
      const res = await fetch('/api/build/media/upload', { method: 'POST', body: fd })
      const d = await res.json().catch(() => null)
      if (res.status === 401) {
        setUploadNotice('You’ll need to sign in before I can keep your photos.')
        return
      }
      if (!res.ok || !d?.url) {
        setUploadNotice(d?.message || 'I couldn’t upload that photo — try again shortly.')
        return
      }
      setUploadNotice('Your photo is in — it’s in the library below.')
      load()
    } catch {
      setUploadNotice('Connection hiccup — try again.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="m-live-card" data-testid="media-panel">
      <div className="m-mono m-live-card-h">
        <span className="m-glyph">◇</span> Auto Media
      </div>

      {!loaded ? (
        <p className="m-mono m-task-empty" data-testid="media-loading">loading media…</p>
      ) : (
        <>
          {!configured && (
            <p className="m-mono m-metric-note" data-testid="media-disabled-note">
              On-brand media generation isn&apos;t switched on for this workspace yet. You can still set a
              schedule now — {companyName || 'your company'} will start producing owned image &amp; video
              assets as soon as it&apos;s enabled.
            </p>
          )}

          {KINDS.map(({ key, title, blurb }) => {
            const routine = routineFor(key)
            const asset = latestAsset(key)
            const next = nextRuns[key]
            return (
              <div key={key} className="m-task-card" data-testid={`media-kind-${key}`} data-media-kind={key}>
                <div className="m-task-card-top">
                  <span className={`st ${routine?.enabled ? 'is-running' : 'is-planned'}`} data-testid={`media-status-${key}`}>
                    {routine?.enabled ? 'AUTO ON' : 'OFF'}
                  </span>
                  <span className="m-chip">{title}</span>
                </div>
                <p className="m-task-title">{blurb}</p>

                {/* Frequency selector (Once / Daily / Weekly / Monthly). */}
                <div className="m-doc-tabs" role="radiogroup" aria-label={`${title} frequency`} data-testid={`media-freq-${key}`}>
                  {FREQUENCIES.map((f) => (
                    <button
                      key={f.key}
                      role="radio"
                      aria-checked={freq[key] === f.key}
                      className={`m-chip m-doc-tab${freq[key] === f.key ? ' is-active' : ''}`}
                      data-testid={`media-freq-${key}-${f.key}`}
                      onClick={() => setFreq((s) => ({ ...s, [key]: f.key }))}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>

                <div className="m-infra-btns">
                  <button
                    className="btn-primary"
                    data-testid={`media-start-${key}`}
                    disabled={busy != null}
                    onClick={() => start(key)}
                  >
                    {busy === `schedule-${key}` || busy === `generate-${key}`
                      ? 'Working…'
                      : routine?.enabled ? `Update Auto ${key === 'image' ? 'Image' : 'Video'}` : `Start Auto ${key === 'image' ? 'Image' : 'Video'}`}
                  </button>
                </div>

                {/* Last-generated + next run (#54 req 3). */}
                <div className="m-task-card-foot m-mono">
                  <span className="m-task-meta" data-testid={`media-next-${key}`}>
                    {routine?.enabled ? `Next run: ${fmtNext(next) || (routine.frequency === 'once' ? 'once, done' : 'scheduled')}` : 'Not scheduled'}
                  </span>
                  <span className="m-task-meta" data-testid={`media-last-${key}`}>
                    {asset ? `Last: ${fmtDate(asset.createdAt)}` : 'No media yet'}
                  </span>
                </div>

                {/* Latest owned asset preview (honest empty otherwise). A text-only
                    "View latest →" link was easy to miss entirely after a real
                    generation — a founder hitting Generate with nothing visibly
                    changing on the page read as "nothing happened." An inline
                    thumbnail (image kind only — video keeps the link, no <video>
                    preview yet) makes the real output immediately visible. */}
                {asset ? (
                  key === 'image' ? (
                    <a
                      className="m-media-thumb-link"
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`media-asset-${key}`}
                    >
                      <img className="m-media-thumb" src={asset.url} alt={`Latest generated ${key} for ${companyName || 'your company'}`} loading="lazy" />
                    </a>
                  ) : (
                    <a
                      className="btn-ghost m-task-view"
                      href={asset.url}
                      target="_blank"
                      rel="noreferrer"
                      data-testid={`media-asset-${key}`}
                    >
                      View latest {key} →
                    </a>
                  )
                ) : null}

                {notice[key] && (
                  <p className="m-mono m-ver-status" data-testid={`media-notice-${key}`}>{notice[key]}</p>
                )}
              </div>
            )
          })}

          {/* Upload your own (#323 / GR-14) — real photos alongside the generated media. */}
          <div className="m-task-card" data-testid="media-upload-card">
            <div className="m-task-card-top">
              <span className="st is-planned">YOURS</span>
              <span className="m-chip">Your Photos</span>
            </div>
            <p className="m-task-title">
              Upload your own photos — your product, your team, your space. I keep them in the same
              library as the media I generate.
            </p>
            <div className="m-infra-btns">
              <button
                className="btn-primary"
                data-testid="media-upload-btn"
                disabled={busy != null}
                onClick={() => fileInputRef.current?.click()}
              >
                {busy === 'upload' ? 'Uploading…' : 'Upload a photo'}
              </button>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept={UPLOAD_ACCEPT_ATTR}
              style={{ display: 'none' }}
              data-testid="media-upload-input"
              onChange={onUploadChange}
            />
            <div className="m-task-card-foot m-mono">
              <span className="m-task-meta">PNG, JPG, WebP or SVG · up to 5MB</span>
            </div>
            {uploadNotice && (
              <p className="m-mono m-ver-status" data-testid="media-upload-notice">{uploadNotice}</p>
            )}
          </div>

          {/* Library — every owned asset, yours and Cody's, distinguishable at a glance. */}
          {assets.length > 0 && (
            <div className="m-task-card" data-testid="media-library">
              <div className="m-task-card-top">
                <span className="m-chip">Library</span>
              </div>
              {assets.slice(0, 12).map((a) => (
                <div key={a.id} className="m-task-card-foot m-mono" data-testid="media-library-item" data-media-source={isUploadedAsset(a) ? 'upload' : 'generated'}>
                  <span className={`st ${isUploadedAsset(a) ? 'is-running' : 'is-planned'}`}>
                    {isUploadedAsset(a) ? 'yours' : '◇ Cody'}
                  </span>
                  <span className="m-task-meta">{a.mediaKind} · {fmtDate(a.createdAt)}</span>
                  <a className="btn-ghost m-task-view" href={a.url} target="_blank" rel="noreferrer">
                    View →
                  </a>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  )
}

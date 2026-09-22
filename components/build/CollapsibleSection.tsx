'use client'

/**
 * Real disclosure/accordion section (#803) — bounds the Live dashboard's
 * middle-column rendered height by letting a founder collapse sections they
 * don't need right now, instead of the column only ever growing as more
 * sections are added over time (the real cause of the "grey region grows as
 * you scroll" bug that's recurred 3x: #484, #754, and again). Mirrors
 * ArtifactRail's existing accordion pattern (m-rail-cat-toggle/m-rail-caret)
 * for the caret/toggle visual language, with its own per-section persisted
 * open/closed state (lib/build/live-section-prefs.ts).
 *
 * Defaults OPEN so nothing looks newly hidden/broken on first load.
 */

import { useEffect, useState } from 'react'
import { isSectionOpen, saveSectionOpen } from '@/lib/build/live-section-prefs'

export function CollapsibleSection({
  slug, sectionId, title, children,
}: {
  slug: string
  sectionId: string
  title: React.ReactNode
  children: React.ReactNode
}) {
  // Lazy-init from the persisted preference so a returning founder doesn't
  // see a flash of open->collapsed on mount.
  const [open, setOpen] = useState(() => isSectionOpen(slug, sectionId))

  // Re-hydrate if the active project changes under this same mounted tree.
  useEffect(() => {
    setOpen(isSectionOpen(slug, sectionId))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug, sectionId])

  const toggle = () => {
    const next = !open
    setOpen(next)
    saveSectionOpen(slug, sectionId, next)
  }

  return (
    <div className="m-collapse" data-testid={`live-section-${sectionId}`} data-open={open}>
      <button
        type="button"
        className="m-collapse-toggle m-mono"
        aria-expanded={open}
        data-testid={`live-section-toggle-${sectionId}`}
        onClick={toggle}
      >
        <span className={`m-collapse-caret ${open ? 'is-open' : ''}`} aria-hidden="true">▸</span>
        <span className="m-collapse-title">{title}</span>
      </button>
      {open && <div className="m-collapse-body">{children}</div>}
    </div>
  )
}

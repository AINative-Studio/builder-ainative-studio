'use client'

/**
 * "Powering this" strip (#221, #288, #66) — shows which AINative primitives are live
 * in the current artifact view, blended with the company's idea-selected set.
 *
 * Two sources are merged, deduped, and shown as chips:
 *  1. The per-view nudge list from PRIMITIVE_MAP (what this artifact uses)
 *  2. The idea-selected primitives for THIS company (so a coffee brand sees
 *     ZeroCommerce; a fundraising co sees OpenCapStack — not always the same 5)
 *
 * The /N counter uses CATALOG_SIZE (real distinct catalog count) not a hardcoded 34.
 *
 * #66: Each chip now shows a one-line tooltip on hover/focus explaining what the
 * primitive does and that it's yours, on your own API. Copy is sourced from
 * getPrimitiveTooltip() in primitive-catalog.ts — not hardcoded here.
 */

import { useMemo, useId } from 'react'
import { PRIMITIVE_MAP, CATALOG_SIZE } from '@/lib/build/primitives'
import { selectPrimitives, getPrimitiveTooltip } from '@/lib/build/primitive-catalog'

interface PoweringThisProps {
  view: string
  /** The founder's idea (used to blend idea-selected primitives). Optional — falls
   *  back to view-only chips when not provided. */
  idea?: string
  /** Show the /N woven counter (used in the act-bar). Default false. */
  showCounter?: boolean
}

/**
 * Individual chip with an accessible tooltip on hover/focus (#66).
 * The tooltip copy comes from getPrimitiveTooltip() — pulled from the
 * primitive catalog, never hardcoded here.
 */
function PrimitiveChip({ label }: { label: string }) {
  const tooltipId = useId()
  const tooltip = getPrimitiveTooltip(label)

  if (!tooltip) {
    // No catalog entry for this internal chip (e.g. "GraphRAG") — render plain.
    return <span className="m-chip">{label}</span>
  }

  return (
    <span className="m-chip-wrap">
      <span
        className="m-chip m-chip-hastooltip"
        aria-describedby={tooltipId}
        tabIndex={0}
        role="button"
        title={`${tooltip} — yours, on your own API.`}
      >
        {label}
      </span>
      <span
        id={tooltipId}
        role="tooltip"
        className="m-chip-tooltip"
      >
        {tooltip} — yours, on your own API.
      </span>
    </span>
  )
}

export function PoweringThis({ view, idea, showCounter }: PoweringThisProps) {
  const entry = PRIMITIVE_MAP[view]

  // Blend: start with the view's fixed list, then add idea-selected ones.
  const chips = useMemo(() => {
    const base: string[] = entry?.powered ?? []
    if (!idea) return base

    const { names } = selectPrimitives(idea, 'company', 4)
    // Merge, dedup, view-specific first then idea-selected
    const seen = new Set(base.map((s) => s.toLowerCase()))
    const merged = [...base]
    for (const n of names) {
      if (!seen.has(n.toLowerCase())) { merged.push(n); seen.add(n.toLowerCase()) }
    }
    // Cap at 8 chips to keep the strip readable
    return merged.slice(0, 8)
  }, [entry, idea])

  if (chips.length === 0) return null

  return (
    <div className="m-powering">
      <span className="m-powering-label m-mono">Powering this</span>
      <div className="m-powering-chips">
        {chips.map((p) => <PrimitiveChip key={p} label={p} />)}
        {showCounter && (
          <span className="m-chip m-chip-counter m-mono" title={`${CATALOG_SIZE} primitives in the catalog`}>
            {chips.length}/{CATALOG_SIZE} woven
          </span>
        )}
      </div>
    </div>
  )
}

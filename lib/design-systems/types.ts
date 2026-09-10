/**
 * Design System Picker (#590-#595) — typed schema for the imported design
 * systems, matching the REAL `theme.json` shape found in the source drop
 * (`~/Downloads/Design systems for builder product/systems/<name>/theme.json`)
 * — not invented. See docs/growth/DESIGN_SYSTEM_PICKER_PLAN_2026-09-09.md.
 */

export type DesignSystemSeries = 'foundation' | 'ainative' | 'builder'

export interface DesignSystemFont {
  family: string
  weights: number[]
}

export interface DesignSystemStatusColors {
  running: string
  success: string
  warning: string
  error: string
  info: string
}

export interface DesignSystemPalette {
  band: 'light' | 'dark'
  bg: string
  surface: string
  text: string
  accent: string
  accent2: string
  /** Not every system defines per-status colors (e.g. Modernist doesn't) —
   *  never fabricate values a source system doesn't actually have. */
  status?: DesignSystemStatusColors
}

export interface DesignSystem {
  /** Stable slug, used as the picker's selection id and the public asset dir name. */
  id: string
  name: string
  series: DesignSystemSeries
  /** The real AINative primitive this system embodies, e.g. "Cody (CTO agent)" — null for general-purpose systems. */
  primitive: string | null
  direction: string
  palette: DesignSystemPalette
  fonts: {
    heading: DesignSystemFont
    body: DesignSystemFont
  }
  radius: number
  shadows: 'none' | 'soft' | 'hard' | 'glow' | 'neu'
  imageTreatment: 'none' | 'grayscale' | 'duotone' | 'halftone' | 'cool' | 'contrast' | 'phosphor' | 'warm' | 'blueprint' | 'sepia'
  /** True when this system is tied to a specific AINative primitive's identity
   *  rather than a general-purpose aesthetic (real theme.json field). */
  brandBound: boolean
  /** Public path to this system's compiled stylesheet, for the picker's live
   *  preview. Absent for Modernist, which already ships as app/modernist.css. */
  stylesheetPath: string | null
}

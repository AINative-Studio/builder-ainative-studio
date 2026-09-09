/**
 * Design System Picker — the MVP catalog of 6 systems (#590).
 *
 * Data below is transcribed exactly from the real theme.json files in the
 * source drop (`~/Downloads/Design systems for builder product/systems/`),
 * except Modernist, whose values come from the LIVE codebase (app/modernist.css)
 * — Modernist is Builder's own existing chrome, already confirmed identical to
 * its counterpart export in that same drop's `_ds/modernist-<uuid>/` bundle.
 *
 * Do not hand-edit values here without re-checking the source file — this
 * catalog is the single source of truth for both the picker UI (#591) and
 * the codegen prompt injection (#592).
 */

import type { DesignSystem } from './types'

export const DESIGN_SYSTEMS: DesignSystem[] = [
  {
    id: 'modernist',
    name: 'Modernist',
    series: 'builder',
    primitive: null,
    direction: "Builder's own current look — brutalist editorial, machine-speech UI",
    palette: {
      band: 'light',
      bg: '#f3f2f2',
      surface: '#e9e7e7',
      text: '#201e1d',
      accent: '#ec3013',
      accent2: '#d7d3d3',
      // Modernist has no per-status semantic palette in the live codebase —
      // omitted rather than fabricated (see types.ts's doc comment).
    },
    fonts: {
      heading: { family: 'Archivo', weights: [400, 500, 600, 700, 800] },
      body: { family: 'Archivo', weights: [400, 500, 600, 700] },
    },
    radius: 0,
    shadows: 'none',
    imageTreatment: 'grayscale',
    brandBound: false,
    stylesheetPath: null,
  },
  {
    id: 'noir',
    name: 'Noir',
    series: 'foundation',
    primitive: null,
    direction: 'Luxury fashion',
    palette: {
      band: 'dark',
      bg: '#101010',
      surface: '#181818',
      text: '#f2efe9',
      accent: '#c9b27c',
      accent2: '#f2efe9',
      status: { running: '#c9b27c', success: '#81bb8d', warning: '#dbb879', error: '#de958e', info: '#7fafe2' },
    },
    fonts: {
      heading: { family: 'Cormorant', weights: [300, 400, 500] },
      body: { family: 'Jost', weights: [300, 400, 500] },
    },
    radius: 0,
    shadows: 'none',
    imageTreatment: 'grayscale',
    brandBound: false,
    stylesheetPath: '/design-systems/noir/styles.css',
  },
  {
    id: 'crayon',
    name: 'Crayon',
    series: 'foundation',
    primitive: null,
    direction: 'Playful / toy',
    palette: {
      band: 'light',
      bg: '#fff8ec',
      surface: '#ffffff',
      text: '#2a1f3d',
      accent: '#ff5c8a',
      accent2: '#ffb703',
      status: { running: '#ff5c8a', success: '#047e39', warning: '#a47807', error: '#b63132', info: '#036bb9' },
    },
    fonts: {
      heading: { family: 'Fredoka', weights: [600, 700] },
      body: { family: 'Nunito', weights: [400, 600, 700] },
    },
    radius: 16,
    shadows: 'hard',
    imageTreatment: 'none',
    brandBound: false,
    stylesheetPath: '/design-systems/crayon/styles.css',
  },
  {
    id: 'cody',
    name: 'Cody',
    series: 'ainative',
    primitive: 'Cody (CTO agent)',
    direction: 'Pair-programming agent',
    palette: {
      band: 'dark',
      bg: '#0b1220',
      surface: '#111827',
      text: '#e5e7eb',
      accent: '#7dd3fc',
      accent2: '#f59e0b',
      status: { running: '#7dd3fc', success: '#10b981', warning: '#f59e0b', error: '#ef4444', info: '#3b82f6' },
    },
    fonts: {
      heading: { family: 'Geist Mono', weights: [500, 700] },
      body: { family: 'Geist', weights: [400, 500, 600] },
    },
    radius: 4,
    shadows: 'none',
    imageTreatment: 'none',
    brandBound: true,
    stylesheetPath: '/design-systems/cody/styles.css',
  },
  {
    id: 'outrun',
    name: 'Outrun',
    series: 'foundation',
    primitive: null,
    direction: 'Neo-retro 80s',
    palette: {
      band: 'dark',
      bg: '#140a2b',
      surface: '#1e1040',
      text: '#fbeaff',
      accent: '#ff2fa0',
      accent2: '#2ee6ff',
      status: { running: '#ff2fa0', success: '#47c86e', warning: '#f1b112', error: '#ff7e77', info: '#61b0fe' },
    },
    fonts: {
      heading: { family: 'Orbitron', weights: [500, 700, 900] },
      body: { family: 'Exo 2', weights: [400, 500, 600] },
    },
    radius: 2,
    shadows: 'glow',
    imageTreatment: 'duotone',
    brandBound: false,
    stylesheetPath: '/design-systems/outrun/styles.css',
  },
  {
    id: 'ledger',
    name: 'Ledger',
    series: 'ainative',
    primitive: 'AI COGS',
    direction: 'Economics & cost accounting',
    palette: {
      band: 'light',
      bg: '#fbfaf6',
      surface: '#f3f1ea',
      text: '#1e2a1f',
      accent: '#1f6f43',
      accent2: '#b8860b',
      status: { running: '#1f6f43', success: '#3f774d', warning: '#9b7b3c', error: '#96534e', info: '#3e6c9b' },
    },
    fonts: {
      heading: { family: 'Libre Franklin', weights: [500, 600, 700] },
      body: { family: 'JetBrains Mono', weights: [400, 500] },
    },
    radius: 0,
    shadows: 'none',
    imageTreatment: 'halftone',
    brandBound: false,
    stylesheetPath: '/design-systems/ledger/styles.css',
  },
]

export function getDesignSystem(id: string): DesignSystem | undefined {
  return DESIGN_SYSTEMS.find((s) => s.id === id)
}

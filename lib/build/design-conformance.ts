/**
 * Design system conformance checker (#751).
 *
 * The Design System Picker (#590-#595) already reaches the codegen prompt —
 * `lib/theme-system.ts`'s `themeFromDesignSystem`/`formatThemeForPrompt`/
 * `applyThemeToPrompt`/`formatDesignSystemExtras`, wired into
 * `app/api/chat-ws/route.ts` — but NOTHING ever checked whether the model
 * actually used the founder's chosen colors in what it generated, versus
 * improvising its own. This module closes that gap: given the founder's
 * chosen DesignSystem (lib/design-systems/catalog.ts, real palette data) and
 * the ACTUAL generated code, it scans for whether the chosen palette's real
 * hex colors genuinely appear.
 *
 * Deliberately coarse, not a full CSS/AST parse — generated code mixes JSX
 * `bg-[#hex]` arbitrary Tailwind values, inline `style={{ color: '#hex' }}`,
 * plain `<style>` blocks, and CSS variables, so a pure class-name allowlist
 * would miss most real generations. Matching against every hex/rgb color
 * literal actually present in the code (case-insensitive, both `#rgb` and
 * `#rrggbb` forms, and `rgb()`/`rgba()`) is sufficient to detect the real gap
 * this issue tracks: today there is ZERO such check, so ANY palette
 * (including one nothing to do with what the founder picked) always "passes".
 *
 * Pure + deterministic. Never throws.
 */

import type { DesignSystem, DesignSystemPalette } from '../design-systems/types'

export type ConformanceStatus = 'pass' | 'partial' | 'fail'

export interface DesignConformanceResult {
  status: ConformanceStatus
  /** 0-1 fraction of checked palette colors actually found in the code. */
  score: number
  /** The palette colors (lowercased hex) that were found in the code. */
  matchedColors: string[]
  /** The palette colors (lowercased hex) that were NOT found in the code. */
  missingColors: string[]
  /** Human-readable summary for logs / the obedience-prompt style surface. */
  summary: string
}

/** Expand a 3-digit hex (#f0a) to its 6-digit form (#ff00aa) for comparison. */
function expandHex3(hex: string): string {
  if (hex.length !== 4) return hex // not #rgb shorthand
  const [, r, g, b] = hex
  return `#${r}${r}${g}${g}${b}${b}`
}

function normalizeHex(hex: string): string | null {
  const trimmed = hex.trim().toLowerCase()
  if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/.test(trimmed)) return null
  return trimmed.length === 4 ? expandHex3(trimmed) : trimmed
}

/** Parse "rgb(r, g, b)" / "rgba(r, g, b, a)" into a normalized #rrggbb, or null. */
function rgbToHex(r: number, g: number, b: number): string | null {
  if ([r, g, b].some((c) => !Number.isFinite(c) || c < 0 || c > 255)) return null
  const toHex = (c: number) => Math.round(c).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

/**
 * Extract every color literal present in a blob of generated code as
 * normalized lowercase #rrggbb hex strings (deduplicated). Handles:
 *  - `#rrggbb` / `#rgb` (Tailwind arbitrary values, inline styles, CSS)
 *  - `rgb(r, g, b)` / `rgba(r, g, b, a)` (occasionally emitted by models)
 * Ignores alpha-channel hex (#rrggbbaa) by comparing only the color portion
 * — an app using the right color at reduced opacity still counts as a match.
 */
export function extractColorsFromCode(code: string): Set<string> {
  const found = new Set<string>()
  if (!code) return found

  // #rgb / #rrggbb / #rrggbbaa (8-digit alpha hex — take just the color part)
  const hexRe = /#([0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{3})\b/g
  let m: RegExpExecArray | null
  while ((m = hexRe.exec(code))) {
    const raw = m[1]
    const colorPart = raw.length === 8 ? raw.slice(0, 6) : raw
    const normalized = normalizeHex(`#${colorPart}`)
    if (normalized) found.add(normalized)
  }

  // rgb()/rgba()
  const rgbRe = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*(?:,\s*[\d.]+\s*)?\)/g
  while ((m = rgbRe.exec(code))) {
    const hex = rgbToHex(Number(m[1]), Number(m[2]), Number(m[3]))
    if (hex) found.add(hex)
  }

  return found
}

/** The real palette colors worth checking for a given DesignSystem — the ones
 *  a founder would actually recognize as "my design system", not incidental
 *  status colors that legitimately vary per element (success/error/etc). */
export function paletteColorsToCheck(palette: DesignSystemPalette): string[] {
  const colors = [palette.accent, palette.accent2, palette.bg, palette.surface]
  const normalized = colors
    .map((c) => normalizeHex(c))
    .filter((c): c is string => c !== null)
  return Array.from(new Set(normalized))
}

/**
 * Check whether generated code actually used a design system's real palette.
 *
 * Classification:
 *  - 'pass'    — at least half the checked palette colors appear in the code.
 *  - 'partial' — at least one, but fewer than half, appear.
 *  - 'fail'    — none of the checked palette colors appear anywhere.
 *
 * `minColors`/`passThreshold` are overridable for testing but default to a
 * conservative real-world setting: a system contributes bg/surface/accent/
 * accent2 (up to 4 checkable colors, deduplicated), and >=50% is a pass.
 */
export function checkDesignConformance(
  designSystem: Pick<DesignSystem, 'name' | 'palette'>,
  generatedCode: string,
  opts: { passThreshold?: number } = {},
): DesignConformanceResult {
  const passThreshold = opts.passThreshold ?? 0.5
  const expected = paletteColorsToCheck(designSystem.palette)
  const present = extractColorsFromCode(generatedCode)

  const matchedColors = expected.filter((c) => present.has(c))
  const missingColors = expected.filter((c) => !present.has(c))
  const score = expected.length > 0 ? matchedColors.length / expected.length : 0

  let status: ConformanceStatus
  if (matchedColors.length === 0) {
    status = 'fail'
  } else if (score >= passThreshold) {
    status = 'pass'
  } else {
    status = 'partial'
  }

  const summary =
    status === 'pass'
      ? `Design conformance: PASS — ${matchedColors.length}/${expected.length} "${designSystem.name}" palette colors found in generated code.`
      : status === 'partial'
        ? `Design conformance: PARTIAL — only ${matchedColors.length}/${expected.length} "${designSystem.name}" palette colors found (missing: ${missingColors.join(', ')}).`
        : `Design conformance: FAIL — none of "${designSystem.name}"'s ${expected.length} palette colors appear in the generated code. The model likely ignored the chosen design system.`

  return { status, score, matchedColors, missingColors, summary }
}

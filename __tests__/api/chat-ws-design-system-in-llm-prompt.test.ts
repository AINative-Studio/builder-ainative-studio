import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * REAL BUG found via live production testing (2026-09-09): a real POST to
 * /api/chat-ws with designSystemId:'cody' completed successfully (real
 * chatId, real generated App.tsx) but the output used generic
 * bg-slate-950/bg-blue-600 and Inter font — the chosen system's real colors,
 * fonts, radius, and shadows never reached the model's actual output.
 *
 * Root cause: chat-ws has TWO system prompts. `enhancedSystemPrompt`
 * (themedPrompt + themePrompt + formatDesignSystemExtras when a system is
 * chosen) is the rich one #592 wired correctly -- but the PRIMARY Claude/
 * Bedrock direct-call path (confirmed live: this exact test request logged
 * "claude-sonnet-4-5-20250929" via Bedrock) sends a SEPARATE, condensed
 * `llmSystemPrompt` (system: llmSystemPrompt, not enhancedSystemPrompt) that
 * only ever had bare color hexes baked into its template -- no font, radius,
 * or shadow instructions at all, regardless of whether a design system was
 * chosen. This is the actual, most-used generation path in production.
 *
 * Fix: llmSystemPrompt now includes the same font/radius/shadow directives
 * (with an exact, pasteable Google Fonts <link> tag) when chosenDesignSystem
 * is set. These are source-level checks (this route is 1858 lines and not
 * unit-testable end-to-end without live model calls) -- the real end-to-end
 * behavior must be re-verified live in production after this fix deploys.
 */
describe('chat-ws llmSystemPrompt includes design-system fonts (2026-09-09 bugfix)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('the PRIMARY Claude/Bedrock call site uses llmSystemPrompt (confirms this is the path that needed the fix)', () => {
    const callSite = source.indexOf('claude.messages.create({')
    const systemArg = source.indexOf('system: llmSystemPrompt')
    expect(callSite).toBeGreaterThan(-1)
    expect(systemArg).toBeGreaterThan(callSite)
    expect(systemArg - callSite).toBeLessThan(600)
  })

  it('llmSystemPrompt conditionally includes font instructions when chosenDesignSystem is set', () => {
    const promptStart = source.indexOf('const llmSystemPrompt = `')
    const fontsBlockStart = source.indexOf('${chosenDesignSystem ? `- FONTS')
    expect(promptStart).toBeGreaterThan(-1)
    expect(fontsBlockStart).toBeGreaterThan(promptStart)
  })

  it('the font instruction embeds a real googleFontsUrl(chosenDesignSystem) call, not a vague description', () => {
    expect(source).toMatch(/href="\$\{googleFontsUrl\(chosenDesignSystem\)\}"/)
  })

  it('the font instruction names the real heading and body font family fields', () => {
    expect(source).toMatch(/chosenDesignSystem\.fonts\.heading\.family/)
    expect(source).toMatch(/chosenDesignSystem\.fonts\.body\.family/)
  })

  it('the font instruction explicitly forbids defaulting to Inter', () => {
    expect(source).toMatch(/NEVER default to Inter/)
  })

  it('includes the real radius and shadows fields, not fabricated defaults', () => {
    expect(source).toMatch(/chosenDesignSystem\.radius/)
    expect(source).toMatch(/chosenDesignSystem\.shadows/)
  })

  it('degrades to an empty string (today\'s exact prior behavior) when no design system is chosen', () => {
    const fontsBlockStart = source.indexOf('${chosenDesignSystem ? `- FONTS')
    // The conditional's false-branch must be immediately after the block
    // closes — i.e. the whole thing collapses to '' when nothing was chosen.
    const nextChunk = source.slice(fontsBlockStart, fontsBlockStart + 2000)
    expect(nextChunk).toContain(": ''}")
  })
})

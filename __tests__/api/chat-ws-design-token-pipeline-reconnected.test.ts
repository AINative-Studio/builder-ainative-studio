import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'
import { tokensFromDesignSystem, formatTokensForPrompt } from '@/lib/services/design-tokens.service'
import { getDesignSystem } from '@/lib/design-systems/catalog'

/**
 * Design-token pipeline reconnection (#751).
 *
 * Prior gap (documented on issue #751): `lib/services/design-tokens.service.ts`'s
 * `buildSystemPromptWithTokens`/`formatTokensForPrompt` were real, tested, but
 * wired ONLY into app/api/chat/route.ts — NOT app/api/chat-ws/route.ts, the
 * actual live founder-facing codegen path (confirmed: components/home/
 * home-client.tsx and components/build/artifacts/Preview.tsx exclusively call
 * /api/chat-ws). Worse, chat-ws has TWO system prompts: `enhancedSystemPrompt`
 * (correctly themed) and a SEPARATE `llmSystemPrompt` that is the one actually
 * sent to the PRIMARY Claude/Bedrock call (see
 * __tests__/api/chat-ws-design-system-in-llm-prompt.test.ts's own 2026-09-09
 * incident writeup — confirmed live via Bedrock logs). This route is 1858+
 * lines and not unit-testable end-to-end without live model calls, so — same
 * convention as that existing test file — these are source-level checks that
 * the real reconnection code exists in the real call path, plus direct
 * function-output checks (not mocks) that the values it injects are real.
 */
describe('chat-ws design-token pipeline reconnection (#751)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('imports the real, already-built token pipeline (not a new mechanism)', () => {
    expect(source).toMatch(/tokensFromDesignSystem,\s*formatTokensForPrompt\s*}\s*from\s*'@\/lib\/services\/design-tokens\.service'/)
  })

  it('builds designTokenBlock from the founder\'s ACTUAL chosen catalog system, not a hardcoded default', () => {
    const blockDecl = source.indexOf('const designTokenBlock =')
    expect(blockDecl).toBeGreaterThan(-1)
    const chunk = source.slice(blockDecl, blockDecl + 400)
    expect(chunk).toContain('chosenDesignSystem')
    expect(chunk).toContain('formatTokensForPrompt(tokensFromDesignSystem(chosenDesignSystem))')
  })

  it('designTokenBlock reaches enhancedSystemPrompt (the orchestrator-agent path)', () => {
    const enhancedDecl = source.indexOf('const enhancedSystemPrompt =')
    expect(enhancedDecl).toBeGreaterThan(-1)
    const line = source.slice(enhancedDecl, enhancedDecl + 300)
    expect(line).toContain('designTokenBlock')
  })

  it('CRITICAL: designTokenBlock also reaches llmSystemPrompt — the prompt actually sent to the PRIMARY Claude/Bedrock call (system: llmSystemPrompt)', () => {
    const llmPromptStart = source.indexOf('const llmSystemPrompt = `')
    const callSite = source.indexOf('system: llmSystemPrompt')
    expect(llmPromptStart).toBeGreaterThan(-1)
    expect(callSite).toBeGreaterThan(llmPromptStart)

    // The template literal must interpolate designTokenBlock before its closing backtick.
    const templateBody = source.slice(llmPromptStart, callSite)
    expect(templateBody).toContain('${designTokenBlock}')
  })

  it('degrades to an empty string (byte-for-byte unchanged prompt) when no design system was chosen', () => {
    const blockDecl = source.indexOf('const designTokenBlock =')
    const chunk = source.slice(blockDecl, blockDecl + 400)
    expect(chunk).toMatch(/:\s*''/)
  })
})

describe('chat-ws design conformance check wiring (#751)', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('imports the real conformance checker (not a new mechanism)', () => {
    expect(source).toMatch(/import\s*{\s*checkDesignConformance\s*}\s*from\s*'@\/lib\/build\/design-conformance'/)
  })

  it('runs the check against finalContent (the ACTUAL served code) using the founder\'s ACTUAL chosen system', () => {
    const decl = source.indexOf('const designConformance =')
    expect(decl).toBeGreaterThan(-1)
    const chunk = source.slice(decl, decl + 300)
    expect(chunk).toContain('checkDesignConformance(chosenDesignSystem, finalContent)')
  })

  it('degrades to undefined (no check run) when no design system was chosen', () => {
    const decl = source.indexOf('const designConformance =')
    const chunk = source.slice(decl, decl + 300)
    expect(chunk).toMatch(/chosenDesignSystem\s*\n?\s*\?\s*checkDesignConformance/)
    expect(chunk).toContain(': undefined')
  })

  it('threads designConformanceStatus into the durable persistGeneration call', () => {
    const persistCallIdx = source.indexOf('status: \'success\', valid: validation.valid')
    expect(persistCallIdx).toBeGreaterThan(-1)
    const chunk = source.slice(persistCallIdx, persistCallIdx + 300)
    expect(chunk).toContain('designConformanceStatus: designConformance?.status')
  })

  it('surfaces designConformance on the real "complete" SSE event (a real consumer, not a silent log)', () => {
    const completeIdx = source.lastIndexOf("type: 'complete'")
    expect(completeIdx).toBeGreaterThan(-1)
    const chunk = source.slice(completeIdx, completeIdx + 300)
    expect(chunk).toContain('designConformance')
  })
})

/**
 * PROOF REQUIREMENT (issue #751, part a): a founder selecting a specific
 * design system results in that system's ACTUAL color value being present in
 * the constructed system prompt — verified here by calling the real
 * function chat-ws now calls (formatTokensForPrompt(tokensFromDesignSystem(...)))
 * and inspecting its real string output, not a mock that only checks
 * "was called".
 */
describe('PROOF: real chosen palette reaches the real constructed prompt fragment', () => {
  it('Outrun (#ff2fa0 hot pink / #2ee6ff cyan) — the exact fragment chat-ws appends is present verbatim', () => {
    const outrun = getDesignSystem('outrun')!
    const fragment = formatTokensForPrompt(tokensFromDesignSystem(outrun))

    // This is the literal string chat-ws's designTokenBlock produces for a
    // founder who picked Outrun — reproduced here byte-for-byte via the same
    // real call chat-ws makes.
    expect(fragment).toContain('#ff2fa0')
    expect(fragment).toContain('#2ee6ff')
    expect(fragment).toContain('#140a2b')
  })
})

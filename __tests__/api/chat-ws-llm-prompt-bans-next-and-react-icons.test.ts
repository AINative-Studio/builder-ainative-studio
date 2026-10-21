import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * Companion to #1151/#1154 (next/image, next/link, next/navigation, next/font,
 * next/dynamic, next/script, and react-icons imports in a generated App.tsx
 * crash the WHOLE Sandpack preview compile, since Sandpack's react-ts
 * template declares no 'next' or 'react-icons' dependency). Those PRs fix
 * the symptom at the Sandpack/jsx-fixer runtime layer by stubbing the import
 * to an inert equivalent after the fact.
 *
 * This closes the same gap one layer up, at the source: llmSystemPrompt
 * (the actual, most-used generation path in production — see
 * chat-ws-design-system-in-llm-prompt.test.ts) never told the model this is
 * NOT a Next.js app, and never listed these as forbidden, even though it
 * already explicitly forbids framer-motion/@radix-ui/other unlisted
 * packages for the exact same "not actually installed in Sandpack" reason.
 * Reducing how often the model reaches for these in the first place is
 * complementary to the runtime stub, not a replacement for it.
 *
 * Source-level check only (this route is 1800+ lines and not unit-testable
 * end-to-end without live model calls), same convention as the sibling
 * design-system prompt test in this directory.
 */
describe('chat-ws llmSystemPrompt bans next/* and react-icons imports', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'app/api/chat-ws/route.ts'), 'utf8')

  it('the IMPORT RULES section explicitly forbids next/* modules', () => {
    const importRulesStart = source.indexOf('IMPORT RULES:')
    expect(importRulesStart).toBeGreaterThan(-1)
    const section = source.slice(importRulesStart, importRulesStart + 1000)
    expect(section).toMatch(/NOT a Next\.js app/)
    expect(section).toContain("'next/image'")
    expect(section).toContain("'next/link'")
    expect(section).toContain("'next/navigation'")
    expect(section).toContain("'next/font'")
    expect(section).toContain("'next/dynamic'")
    expect(section).toContain("'next/script'")
    expect(section).toMatch(/'next\/\*'/)
  })

  it('the IMPORT RULES section explicitly forbids react-icons', () => {
    const importRulesStart = source.indexOf('IMPORT RULES:')
    const section = source.slice(importRulesStart, importRulesStart + 1000)
    expect(section).toMatch(/NEVER use 'react-icons'/)
  })

  it('the new rule sits in the same IMPORT RULES block as the existing framer-motion/@radix-ui ban', () => {
    const framerBanIdx = source.indexOf('NEVER use framer-motion, @radix-ui')
    const nextBanIdx = source.indexOf("NEVER import from 'next/image'")
    expect(framerBanIdx).toBeGreaterThan(-1)
    expect(nextBanIdx).toBeGreaterThan(framerBanIdx)
    expect(nextBanIdx - framerBanIdx).toBeLessThan(300)
  })
})

import fs from 'fs'
import path from 'path'
import { describe, it, expect } from 'vitest'

/**
 * #2218 — AX "Agent Discoverability" gap (3/4): the real checker
 * (core's check_agent_discoverability) credits /AGENTS.md as one of 9
 * possible discovery files. A genuinely separate document from
 * public/agents.txt (machine-parsable capability manifest) and
 * public/SKILL.md (Claude-skill format) — this is the plain-Markdown
 * agents.md-convention entry point, so it must say something real and
 * distinct, not duplicate either.
 */
describe('public/AGENTS.md', () => {
  const content = fs.readFileSync(path.join(process.cwd(), 'public/AGENTS.md'), 'utf-8')

  it('is real, substantive content — not a placeholder', () => {
    expect(content.length).toBeGreaterThan(200)
  })

  it('points to the other real discovery documents rather than duplicating their content', () => {
    expect(content).toContain('/agents.txt')
    expect(content).toContain('/SKILL.md')
    expect(content).toContain('/llms.txt')
  })

  it('does not repeat the full capability manifest verbatim — stays a distinct entry point', () => {
    // agents.txt's own distinguishing content (the exact capability contract
    // lines) should not be copy-pasted into AGENTS.md.
    expect(content).not.toContain('Capability: generate-app')
  })
})

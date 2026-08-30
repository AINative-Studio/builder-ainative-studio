import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  buildImplementationSystemPrompt,
  buildImplementationUserPrompt,
  parseImplementationResponse,
} from '@/lib/build/task-implementer'

/**
 * #373 (epic #371) — pure-logic unit tests for the LLM-driven task
 * implementation step. See task-implementer-io.test.ts for the mocked-client
 * implementTask() tests.
 */

describe('buildImplementationSystemPrompt', () => {
  it('instructs the smallest correct change, preserving unrelated code', () => {
    const prompt = buildImplementationSystemPrompt()
    expect(prompt).toMatch(/smallest correct change/i)
    expect(prompt).toMatch(/preserve everything not related/i)
  })

  it('carries the security-baseline standard (from #365)', () => {
    const prompt = buildImplementationSystemPrompt()
    expect(prompt).toMatch(/dangerouslySetInnerHTML/)
    expect(prompt).toMatch(/never log secrets/i)
  })

  it('requires an honest ok:false path rather than a fabricated implementation', () => {
    const prompt = buildImplementationSystemPrompt()
    expect(prompt).toMatch(/do NOT invent a fake implementation/i)
    expect(prompt).toMatch(/"ok":\s*false/)
  })

  it('specifies the strict JSON output contract', () => {
    const prompt = buildImplementationSystemPrompt()
    expect(prompt).toMatch(/"ok":\s*true/)
    expect(prompt).toMatch(/"files"/)
  })
})

describe('buildImplementationUserPrompt', () => {
  it('includes the story title and detail', () => {
    const prompt = buildImplementationUserPrompt(
      { title: 'Add a dark mode toggle', detail: 'Persist the choice in localStorage' },
      {},
    )
    expect(prompt).toContain('Add a dark mode toggle')
    expect(prompt).toContain('Persist the choice in localStorage')
  })

  it('omits the DETAIL line when detail is absent', () => {
    const prompt = buildImplementationUserPrompt({ title: 'Just a title' }, {})
    expect(prompt).toContain('Just a title')
    expect(prompt).not.toMatch(/DETAIL:/)
  })

  it('includes every existing file with a FILE marker', () => {
    const prompt = buildImplementationUserPrompt(
      { title: 'x' },
      { 'app/page.tsx': 'export default function Page() {}', 'lib/utils.ts': 'export const x = 1' },
    )
    expect(prompt).toContain('// --- FILE: app/page.tsx ---')
    expect(prompt).toContain('export default function Page() {}')
    expect(prompt).toContain('// --- FILE: lib/utils.ts ---')
  })

  it('handles an empty existing-files map honestly (first change to the app)', () => {
    const prompt = buildImplementationUserPrompt({ title: 'x' }, {})
    expect(prompt).toMatch(/no existing files/i)
  })
})

describe('parseImplementationResponse', () => {
  it('parses a clean success response', () => {
    const raw = JSON.stringify({ ok: true, files: { 'app/page.tsx': 'new content' } })
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(true)
    expect(result.files).toEqual({ 'app/page.tsx': 'new content' })
  })

  it('strips a ```json fence around the object', () => {
    const raw = '```json\n' + JSON.stringify({ ok: true, files: { 'a.ts': 'x' } }) + '\n```'
    expect(parseImplementationResponse(raw).ok).toBe(true)
  })

  it('extracts a JSON object even with stray prose around it', () => {
    const raw = 'Sure, here you go: ' + JSON.stringify({ ok: true, files: { 'a.ts': 'x' } }) + ' Hope that helps!'
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(true)
    expect(result.files).toEqual({ 'a.ts': 'x' })
  })

  it('respects an honest ok:false from the model, never overrides it', () => {
    const raw = JSON.stringify({ ok: false, reason: 'The story contradicts the existing auth flow.' })
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(false)
    expect(result.reason).toBe('The story contradicts the existing auth flow.')
  })

  it('returns ok:false with a reason for an empty response — never fabricates success', () => {
    const result = parseImplementationResponse('')
    expect(result.ok).toBe(false)
    expect(result.reason).toBeDefined()
  })

  it('returns ok:false for unparseable JSON — never guesses', () => {
    const result = parseImplementationResponse('this is not json at all')
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/parseable JSON/i)
  })

  it('returns ok:false when files is missing even if ok:true is claimed', () => {
    const raw = JSON.stringify({ ok: true })
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/files/i)
  })

  it('returns ok:false when files is present but empty — never a no-op success', () => {
    const raw = JSON.stringify({ ok: true, files: {} })
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(false)
    expect(result.reason).toMatch(/no changed files/i)
  })

  it('drops non-string file entries defensively rather than crashing', () => {
    const raw = JSON.stringify({ ok: true, files: { 'good.ts': 'real content', 'bad.ts': 123 } })
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(true)
    expect(result.files).toEqual({ 'good.ts': 'real content' })
  })

  it('returns ok:false when files is an array instead of an object', () => {
    const raw = JSON.stringify({ ok: true, files: ['not', 'an', 'object'] })
    const result = parseImplementationResponse(raw)
    expect(result.ok).toBe(false)
  })
})

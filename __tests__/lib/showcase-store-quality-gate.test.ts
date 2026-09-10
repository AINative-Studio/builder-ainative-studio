import { describe, it, expect, beforeEach } from 'vitest'
import { addToShowcase, getDynamicShowcase } from '@/lib/showcase-store'

/**
 * Real bug found live (2026-09-10): addToShowcase's only gate was a bare
 * 200-char floor on codeLength — NO real quality check at all. Every
 * syntactically-valid-but-degraded/broken/internal-test generation over
 * 200 chars got auto-added to the public showcase (confirmed live: dozens
 * of duplicate/junk entries). It must use the SAME isQualityApp gate the
 * ZeroDB-backed listing path already applies, not a weaker one, since both
 * feed the same public gallery.
 */
const bigValidCode = 'function App() { return <div>Real app content here</div> }; '.repeat(60) // > 2000 chars

function resetStore() {
  // showcase-store keeps state on globalThis; clear it between tests.
  const g = globalThis as unknown as { __showcaseDynamic?: unknown[] }
  if (g.__showcaseDynamic) g.__showcaseDynamic.length = 0
}

describe('addToShowcase — real quality gate (2026-09-10 fix)', () => {
  beforeEach(() => resetStore())

  it('rejects code under 2000 chars even if over the old 200-char floor', () => {
    const shortCode = 'function App() { return <div>hi</div> }' // > 200 chars is false here, but test explicitly under 2000
    const added = addToShowcase('Build a todo app', 'chat-short', shortCode.length, shortCode)
    expect(added).toBe(false)
    expect(getDynamicShowcase().find((e) => e.chatId === 'chat-short')).toBeUndefined()
  })

  it('accepts substantial, real-looking code', () => {
    const added = addToShowcase('Build a todo app with drag and drop', 'chat-good', bigValidCode.length, bigValidCode)
    expect(added).toBe(true)
    expect(getDynamicShowcase().find((e) => e.chatId === 'chat-good')).toBeDefined()
  })

  it('rejects when generatedCode is missing entirely, even with a large codeLength number', () => {
    // Real bug shape: the old gate trusted the caller-supplied codeLength
    // number alone — a caller could report a big length without the actual
    // code ever being checked. isQualityApp requires the real code string.
    const added = addToShowcase('Build a todo app', 'chat-no-code', 5000)
    expect(added).toBe(false)
  })

  it('uses the real extracted idea (not the generic wrapper) as the title', () => {
    const prompt = 'Build a polished, working web app for this idea: a habit tracker with streaks. Make it interactive and visually complete with realistic sample data.'
    addToShowcase(prompt, 'chat-title', bigValidCode.length, bigValidCode)
    const e = getDynamicShowcase().find((x) => x.chatId === 'chat-title')
    expect(e).toBeDefined()
    expect(e!.title.toLowerCase()).not.toContain('polished')
    expect(e!.title.toLowerCase()).toContain('habit tracker')
  })
})

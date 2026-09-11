import { describe, it, expect } from 'vitest'
import { validateJavaScriptCode } from '@/lib/code-validator'

/**
 * Regression: /api/db/{table}'s real response is NEVER a bare array —
 * success is `{ data: [...], total, ... }`, an error is `{ error, detail }`
 * (app/api/db/[table]/route.ts's normalizeBody) — but the model routinely
 * writes `.then(data => setX(data))`, passing the whole envelope straight
 * into React state.
 *
 * Found live (builder#671): a fresh, real product-track generation (Ember
 * Box) had this exact bug in BOTH its ember_ratings and ember_sauces loads.
 * Since the table hadn't been created yet (the normal first-run state for a
 * freshly generated app, not an edge case), /api/db/ember_ratings genuinely
 * returned `{"error":"ZeroDB error: 404","detail":"..."}` live, and
 * `setRatings()` received that error object directly — the whole app then
 * crashed on load with "TypeError: ratings is not iterable" the moment
 * `[...ratings].sort(...)` ran.
 *
 * The correct pattern (`setX(data.data || [])`) is already documented in
 * this app's own system prompt (lib/professional-prompt.ts) — this is a
 * prompt-ADHERENCE gap, not a missing-documentation gap, so it needs an
 * enforced auto-fix rather than relying on the prompt alone.
 */
describe('/api/db response-envelope unwrap auto-fix (#671)', () => {
  it('wraps a bare setter call fed directly from an /api/db list fetch (the real Ember Box bug)', () => {
    const code = [
      "import React, { useState, useEffect } from 'react'",
      'export default function App() {',
      '  const [ratings, setRatings] = useState([]);',
      '  useEffect(() => {',
      "    fetch('/api/db/ember_ratings')",
      '      .then(response => response.json())',
      '      .then(data => setRatings(data))',
      '      .catch(() => setRatings([]));',
      '  }, []);',
      '  return <div>{ratings.length}</div>',
      '}',
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
    expect(r.fixes).toEqual(
      expect.arrayContaining([expect.stringContaining('Unwrapped /api/db response envelope')]),
    )
    // The rewritten call must defensively unwrap .data, never trust it's
    // already an array, and fall back to [] for any non-array shape
    // (covers both the { data: [...] } success envelope and the
    // { error, detail } error shape — neither is ever a bare array).
    expect(r.code).toMatch(/setRatings\(Array\.isArray\(data\?\.data\) \? data\.data : \[\]\)/)
    expect(r.code).not.toMatch(/\.then\(\s*data\s*=>\s*setRatings\(\s*data\s*\)\s*\)/)
  })

  it('fixes multiple independent /api/db loads in the same file (Ember Box had two: ember_sauces AND ember_ratings)', () => {
    const code = [
      "fetch('/api/db/ember_sauces').then(response => response.json()).then(data => setSauceNames(data)).catch(() => setSauceNames([]));",
      "fetch('/api/db/ember_ratings').then(response => response.json()).then(data => setRatings(data)).catch(() => setRatings([]));",
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.code).toMatch(/setSauceNames\(Array\.isArray\(data\?\.data\) \? data\.data : \[\]\)/)
    expect(r.code).toMatch(/setRatings\(Array\.isArray\(data\?\.data\) \? data\.data : \[\]\)/)
    expect(r.fixes?.length).toBeGreaterThanOrEqual(2)
  })

  it('does NOT touch code that already correctly unwraps .data', () => {
    const code = [
      "fetch('/api/db/todos').then(response => response.json()).then(data => setTodos(data.data || [])).catch(() => setTodos([]));",
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.code).toContain('setTodos(data.data || [])')
    expect(r.fixes || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Unwrapped /api/db response envelope')]),
    )
  })

  it('does NOT touch a /api/db fetch with a query string (?filter=/?search= have their own, different response shapes)', () => {
    const code = [
      "fetch('/api/db/todos?filter=%7B%7D').then(response => response.json()).then(data => setTodos(data)).catch(() => setTodos([]));",
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.fixes || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Unwrapped /api/db response envelope')]),
    )
  })

  it('does NOT touch fetches to unrelated endpoints (e.g. /api/primitive/*, which has its own real response shapes)', () => {
    const code = [
      "fetch('/api/primitive/zeropipeline/deals').then(response => response.json()).then(data => setDeals(data)).catch(() => setDeals([]));",
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.fixes || []).not.toEqual(
      expect.arrayContaining([expect.stringContaining('Unwrapped /api/db response envelope')]),
    )
  })

  it('produces syntactically valid code after the rewrite (real Babel parse, not just string matching)', () => {
    const code = [
      "import React, { useState, useEffect } from 'react'",
      'export default function App() {',
      '  const [ratings, setRatings] = useState([]);',
      '  useEffect(() => {',
      "    fetch('/api/db/ember_ratings')",
      '      .then(response => response.json())',
      '      .then(data => setRatings(data))',
      '      .catch(() => setRatings([]));',
      '  }, []);',
      '  const sorted = [...ratings].sort((a, b) => a - b);',
      '  return <div>{sorted.length}</div>',
      '}',
    ].join('\n')

    const r = validateJavaScriptCode(code)
    expect(r.valid).toBe(true)
    // validateJavaScriptCode itself runs a real Babel parse internally and
    // would report invalid: false on a syntax error, so r.valid === true
    // here is already proof the rewrite is syntactically sound.
  })
})

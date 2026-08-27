'use client'

/**
 * ImStuck (#321, GR-12) — the in-context "I'm stuck" jump-to-answer box.
 *
 * A single input ("Where are you stuck?") + an answer panel of deep links into
 * the exact guide sections / FAQ entries that answer the question. Embedded at
 * the bottom of /help and every /guides/[slug] page, so a stuck reader never
 * has to leave the page to hunt for the answer.
 *
 * Posts to /api/help/stuck, which runs a pure keyword search over the FULL
 * guides + FAQ catalog (lib/help/stuck-search.ts) — no model call, instant.
 * Kept as a small client island so the surrounding pages stay SSR/crawlable.
 *
 * Styled with the Modernist system (.modernist scope, .m-stuck-* classes in
 * app/modernist.css): flat, 0 radius, typographic glyphs only.
 */

import { useState, type FormEvent } from 'react'

interface StuckResult {
  href: string
  title: string
  parentTitle: string
  source: string
  snippet: string
  score: number
}

export function ImStuck() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [results, setResults] = useState<StuckResult[] | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || loading) return

    setLoading(true)
    setError('')
    setResults(null)
    try {
      const res = await fetch('/api/help/stuck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !Array.isArray(data?.results)) {
        setError('I could not run the search. The FAQ on /help covers the most common blockers.')
        return
      }
      setResults(data.results)
    } catch {
      setError('I could not run the search. The FAQ on /help covers the most common blockers.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="modernist m-stuck" data-agent-role="im-stuck">
      <p className="m-eyebrow m-stuck-eyebrow">
        <span className="m-glyph" aria-hidden>
          ◇
        </span>{' '}
        I&rsquo;m stuck
      </p>
      <p className="m-stuck-lead">
        Tell me where you&rsquo;re stuck and I&rsquo;ll point you at the exact
        section of the guides or FAQ that answers it.
      </p>

      <form onSubmit={onSubmit} className="m-stuck-form">
        <label htmlFor="im-stuck-question" className="sr-only">
          Where are you stuck?
        </label>
        <input
          id="im-stuck-question"
          name="question"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Where are you stuck?"
          className="m-stuck-input"
          autoComplete="off"
          data-testid="im-stuck-input"
        />
        <button
          type="submit"
          className="m-stuck-btn"
          disabled={loading || !question.trim()}
          data-testid="im-stuck-submit"
        >
          {loading ? 'Searching…' : 'Find the answer'}
        </button>
      </form>

      {error && (
        <p role="alert" className="m-stuck-error m-mono">
          {error}
        </p>
      )}

      {results && (
        <div className="m-stuck-results" data-agent-role="answers" aria-live="polite">
          {results.length === 0 ? (
            <p className="m-stuck-empty">
              I did not find a matching section for that. Try different words,
              or browse the FAQ on /help and the guides index at /guides.
            </p>
          ) : (
            <ul className="m-stuck-list" data-testid="im-stuck-results">
              {results.map((r) => (
                <li key={r.href} className="m-stuck-item">
                  <a href={r.href} className="m-stuck-link">
                    <span className="m-stuck-parent m-mono">{r.parentTitle}</span>
                    <span className="m-stuck-title">
                      <span className="m-glyph" aria-hidden>
                        →
                      </span>{' '}
                      {r.title}
                    </span>
                    <span className="m-stuck-snippet">{r.snippet}</span>
                  </a>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

'use client'

/**
 * HelpAskBox (#60) — the client-side AI "Ask anything" box for /help.
 *
 * Posts the question to /api/build/help, which answers grounded in the curated
 * FAQ + docs (RAG). Renders the answer plus the FAQ sources it was grounded in.
 * Kept as a small client island so the surrounding page stays SSR/crawlable and
 * the FAQ + JSON-LD are server-rendered for AEO.
 */

import { useState, type FormEvent } from 'react'

interface Source {
  id: string
  question: string
}

interface HelpAnswer {
  answer: string
  sources?: Source[]
}

export function HelpAskBox() {
  const [question, setQuestion] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [result, setResult] = useState<HelpAnswer | null>(null)

  async function onSubmit(e: FormEvent) {
    e.preventDefault()
    const q = question.trim()
    if (!q || loading) return

    setLoading(true)
    setError('')
    setResult(null)
    try {
      const res = await fetch('/api/build/help', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question: q }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.answer) {
        setError('Help is temporarily unavailable. Please try the FAQ below or /guides.')
        return
      }
      setResult({ answer: data.answer, sources: data.sources })
    } catch {
      setError('Something went wrong. Please try the FAQ below or /guides.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={{ textAlign: 'left' }} data-agent-role="ask">
      <form onSubmit={onSubmit} style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
        <label htmlFor="help-question" className="sr-only">
          Ask anything about AINative Builder
        </label>
        <input
          id="help-question"
          name="question"
          type="text"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="Ask anything about AINative Builder…"
          style={{
            flex: '1 1 240px', border: '1.5px solid var(--neutral-line)', background: '#fff',
            padding: '12px 16px', fontSize: 15, fontFamily: 'var(--font-body)', color: 'var(--color-text)',
          }}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="btn-primary"
          style={{ opacity: loading || !question.trim() ? 0.5 : 1 }}
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && (
        <p role="alert" style={{ marginTop: 16, fontSize: 14, color: 'var(--color-accent-700)' }}>
          {error}
        </p>
      )}

      {result && (
        <div
          style={{ marginTop: 24, border: '1.5px solid var(--color-divider)', padding: 24, background: 'var(--color-surface)' }}
          data-agent-role="answer"
          aria-live="polite"
        >
          <p style={{ lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{result.answer}</p>
          {result.sources && result.sources.length > 0 && (
            <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1.5px solid var(--color-divider)' }}>
              <p className="m-mono" style={{ fontSize: 10.5, textTransform: 'uppercase', letterSpacing: '.08em', color: 'var(--text-muted)', marginBottom: 8 }}>
                Grounded in
              </p>
              <ul style={{ display: 'flex', flexWrap: 'wrap', gap: 8, listStyle: 'none', padding: 0 }}>
                {result.sources.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="m-mono"
                      style={{ fontSize: 11, border: '1.5px solid var(--neutral-line)', padding: '4px 12px', color: 'var(--text-muted)', textDecoration: 'none' }}
                    >
                      {s.question}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

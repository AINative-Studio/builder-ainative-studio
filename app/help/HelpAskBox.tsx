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
    <div className="text-left" data-agent-role="ask">
      <form onSubmit={onSubmit} className="flex flex-col sm:flex-row gap-3">
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
          className="flex-1 rounded-md border border-input bg-background px-4 py-3 text-base focus:outline-none focus:ring-2 focus:ring-ring"
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={loading || !question.trim()}
          className="inline-flex items-center justify-center rounded-md bg-primary px-6 py-3 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
        >
          {loading ? 'Asking…' : 'Ask'}
        </button>
      </form>

      {error && (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {error}
        </p>
      )}

      {result && (
        <div
          className="mt-6 border rounded-lg p-6 bg-muted/30"
          data-agent-role="answer"
          aria-live="polite"
        >
          <p className="leading-relaxed whitespace-pre-wrap">{result.answer}</p>
          {result.sources && result.sources.length > 0 && (
            <div className="mt-4 pt-4 border-t border-border">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground mb-2">
                Grounded in
              </p>
              <ul className="flex flex-wrap gap-2">
                {result.sources.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${s.id}`}
                      className="text-xs rounded-full border px-3 py-1 text-muted-foreground hover:text-foreground hover:border-foreground/40 transition-colors"
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

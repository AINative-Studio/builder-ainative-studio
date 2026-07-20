/**
 * Graceful-degradation fallback for the generation pipeline (builder#77).
 *
 * When a generation fails validation and every retry + agent-fallback attempt
 * is exhausted, we must NOT ship the broken code to Sandpack — that renders the
 * "Something went wrong" crash overlay, a dead-end for the user. Instead we
 * render this clean, intentional component in the preview area: it explains what
 * happened and offers a clear next step, while the raw invalid code stays
 * available behind "View problematic code" for debugging.
 */

/** Escape a user prompt for safe embedding inside a JS string literal in JSX. */
export function escapeForJsxString(input: string): string {
  return String(input ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/`/g, '\\`')
    .replace(/\$\{/g, '\\${')
    .replace(/'/g, "\\'")
    .replace(/"/g, '\\"')
    .replace(/[\r\n]+/g, ' ')
    .slice(0, 200)
}

/**
 * Build a self-contained, always-valid React component that renders a friendly
 * "still working on it" state for the given prompt. Returns TSX source suitable
 * for Sandpack's `/App.tsx`.
 */
export function buildValidationFallbackComponent(prompt: string): string {
  const safePrompt = escapeForJsxString(prompt)
  return `import React from 'react'

export default function App() {
  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: '#f8fafc',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      padding: '24px',
    }}>
      <div style={{
        maxWidth: '440px',
        textAlign: 'center',
        background: '#ffffff',
        border: '1px solid #e2e8f0',
        borderRadius: '16px',
        padding: '40px 32px',
        boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
      }}>
        <div style={{ fontSize: '40px', marginBottom: '12px' }}>🛠️</div>
        <h1 style={{ fontSize: '20px', fontWeight: 700, color: '#0f172a', margin: '0 0 8px' }}>
          Refining your app
        </h1>
        <p style={{ fontSize: '14px', color: '#475569', lineHeight: 1.6, margin: '0 0 20px' }}>
          AINative generated a first version of "{'${safePrompt}'}" but it needs another
          pass to render cleanly. Try regenerating — the next attempt usually gets it.
        </p>
        <div style={{
          fontSize: '13px',
          color: '#64748b',
          background: '#f1f5f9',
          borderRadius: '8px',
          padding: '10px 14px',
        }}>
          Tip: a more specific prompt often produces a cleaner build.
        </div>
      </div>
    </div>
  )
}
`
}

'use client'

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontFamily:
            '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
          backgroundColor: '#000',
          color: '#fff',
        }}
      >
        <div style={{ textAlign: 'center', maxWidth: 400, padding: 24 }}>
          <div style={{ fontSize: 48, marginBottom: 16, color: '#666' }}>!</div>
          <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>
            Something went wrong
          </h2>
          <p style={{ color: '#999', marginBottom: 24 }}>
            A critical error occurred. Please try again.
          </p>
          <button
            onClick={reset}
            style={{
              backgroundColor: '#5867EF',
              color: '#fff',
              border: 'none',
              borderRadius: 8,
              padding: '10px 20px',
              fontSize: 14,
              fontWeight: 500,
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  )
}

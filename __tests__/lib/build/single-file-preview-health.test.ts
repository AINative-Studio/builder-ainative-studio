import { describe, it, expect } from 'vitest'
import { checkSingleFilePreviewHealth } from '@/lib/build/single-file-preview-health'

/**
 * #2226 — the real server-side failure page vs. the always-present, never-
 * conclusive-on-its-own embedded ErrorBoundary fallback. See the module's
 * own doc comment for the full real-world repro (#2222) this distinction
 * is based on.
 */

const REAL_FAILURE_PAGE = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body>
  <div>
    <h1 style="font-size:20px;font-weight:700;color:#0f172a;margin:0 0 8px">This build needs another pass</h1>
    <p>Cody's first version didn't render cleanly.</p>
    <button id="regen" style="background:#ec3013">Regenerate this app</button>
  </div>
</body>
</html>
`

const HEALTHY_BUNDLE_WITH_EMBEDDED_FALLBACK = `
<!DOCTYPE html>
<html>
<head>
  <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
  <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
</head>
<body>
  <script type="text/babel">
    class ErrorBoundary extends React.Component {
      render() {
        if (this.state.hasError) {
          return React.createElement('div', {}, [
            React.createElement('h1', { key: 'title' }, 'Refining your app'),
            React.createElement('p', { key: 'body' }, 'AINative built a first version but it needs another pass to render cleanly. Try regenerating.'),
            React.createElement('button', { key: 'regenerate' }, '↻ Regenerate'),
          ])
        }
        return this.props.children
      }
    }
    ReactDOM.render(React.createElement(App), document.getElementById('root'))
  </script>
</body>
</html>
`

describe('checkSingleFilePreviewHealth', () => {
  it('flags the real server-side pre-validation failure page as broken', () => {
    const result = checkSingleFilePreviewHealth(REAL_FAILURE_PAGE)
    expect(result.brokenServerSide).toBe(true)
    expect(result.looksLikeRealBundle).toBe(false)
  })

  it('does NOT flag a healthy bundle merely because it embeds the generic ErrorBoundary fallback source', () => {
    // This is the exact false-positive #2222 found: every single-file
    // preview bundle contains this fallback as dead code, broken or not.
    const result = checkSingleFilePreviewHealth(HEALTHY_BUNDLE_WITH_EMBEDDED_FALLBACK)
    expect(result.brokenServerSide).toBe(false)
    expect(result.looksLikeRealBundle).toBe(true)
  })

  it('requires BOTH the heading and the regen button id — a near-miss with only one is not enough', () => {
    const headingOnly = '<h1>This build needs another pass</h1><button>Regenerate</button>'
    expect(checkSingleFilePreviewHealth(headingOnly).brokenServerSide).toBe(false)

    const buttonOnly = '<h1>Something else entirely</h1><button id="regen">Regenerate</button>'
    expect(checkSingleFilePreviewHealth(buttonOnly).brokenServerSide).toBe(false)
  })

  it('makes no claim either way for empty or missing input', () => {
    expect(checkSingleFilePreviewHealth('')).toEqual({ brokenServerSide: false, looksLikeRealBundle: false })
    expect(checkSingleFilePreviewHealth(undefined)).toEqual({ brokenServerSide: false, looksLikeRealBundle: false })
    expect(checkSingleFilePreviewHealth(null)).toEqual({ brokenServerSide: false, looksLikeRealBundle: false })
  })

  it('does not misread an unrelated 404/error document as a real bundle', () => {
    const result = checkSingleFilePreviewHealth('<html><body>404 Not Found</body></html>')
    expect(result.brokenServerSide).toBe(false)
    expect(result.looksLikeRealBundle).toBe(false)
  })
})

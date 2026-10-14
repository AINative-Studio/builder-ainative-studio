/**
 * Minimal baseline fixture for the sandpack-bundler E2E verification harness
 * (scripts/verify-sandpack-bundler-e2e.ts).
 *
 * Single component, zero third-party deps beyond react/react-dom. This is
 * the floor: if this is slow, the bundler itself is broken, independent of
 * the barrel-export tree-shaking problem tracked in issue #1089.
 */
import type { SandpackFixture } from './types'

export const minimalFixture: SandpackFixture = {
  name: 'minimal',
  description: 'Single component, no third-party deps — baseline compile time',
  dependencies: {
    react: '18.2.0',
    'react-dom': '18.2.0',
  },
  files: {
    '/App.tsx': `import React from 'react'

export default function App() {
  return (
    <div style={{ padding: 24, fontFamily: 'system-ui' }}>
      <h1 data-testid="verify-heading">Minimal Fixture OK</h1>
      <p data-testid="verify-marker">sandpack-e2e-minimal-render-marker</p>
    </div>
  )
}
`,
  },
  /** DOM text that must be visible once render completes. */
  expectedText: 'sandpack-e2e-minimal-render-marker',
}

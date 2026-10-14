/**
 * Bounded-timeout regression fixture for the sandpack-bundler E2E
 * verification harness (scripts/verify-sandpack-bundler-e2e.ts).
 *
 * Points at a deliberately nonexistent npm package. This exists to confirm
 * a broken dependency fails BOUNDED and SURFACED (an explicit error event
 * within a reasonable window), not a silent indefinite hang — the exact
 * reliability gap documented in components/chat/sandpack-preview.tsx's
 * SandpackResilientTimeout doc comment (CodeSandbox/unpkg issue #703).
 *
 * This is a regression guard, not a performance case: it is NOT expected to
 * render successfully, and is scored differently by the harness (pass =
 * bounded failure, fail = hang past the timeout window).
 */
import type { SandpackFixture } from './types'

export const brokenDependencyFixture: SandpackFixture = {
  name: 'broken-dependency',
  description:
    'Deliberately nonexistent npm dependency — must fail bounded with a surfaced error, never hang silently',
  dependencies: {
    react: '18.2.0',
    'react-dom': '18.2.0',
    // Deliberately bogus: no such package/version exists on the registry.
    '@ainative-does-not-exist/nonexistent-package-for-e2e-verification': '99.99.99',
  },
  files: {
    '/App.tsx': `import React from 'react'
import { nothing } from '@ainative-does-not-exist/nonexistent-package-for-e2e-verification'

export default function App() {
  return (
    <div style={{ padding: 24 }}>
      <p data-testid="verify-marker">sandpack-e2e-broken-dependency-render-marker</p>
      {typeof nothing}
    </div>
  )
}
`,
  },
  // Never actually expected to render — see isRegressionCase in the harness.
  expectedText: 'sandpack-e2e-broken-dependency-render-marker',
}

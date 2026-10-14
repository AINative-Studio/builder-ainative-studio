/** Shared types for scripts/verify-sandpack-bundler-e2e.ts fixtures. */

export interface SandpackFixture {
  name: string
  description: string
  dependencies: Record<string, string>
  /** Sandpack file map: path -> source code. Entry is always /App.tsx. */
  files: Record<string, string>
  /**
   * Plain text that must be present in the rendered iframe's DOM once the
   * compile+render cycle completes successfully. Used for real visual/DOM
   * verification, not just "no error thrown".
   */
  expectedText: string
}

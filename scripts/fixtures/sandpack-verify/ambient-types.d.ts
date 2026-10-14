/**
 * Ambient module declarations for scripts/verify-sandpack-bundler-e2e.ts and
 * scripts/fixtures/sandpack-verify/browser-entry.ts.
 *
 * Both `@codesandbox/sandpack-client` and `esbuild` are real, installed
 * packages (the former resolved via this repo's pnpm override to AINative's
 * sandpack-client fork; the latter a transitive dep of `tsx`/`next`) — but
 * neither has a top-level node_modules symlink of its own in this repo's
 * pnpm layout, since neither is a DIRECT dependency. The harness resolves
 * both at runtime by walking through a package that already depends on them
 * (see resolveViaDependent() in verify-sandpack-bundler-e2e.ts), which works
 * fine for Node's module resolution but isn't something tsc's `bundler`
 * moduleResolution can see from these two files' location. These
 * declarations are intentionally narrow — only the surface the harness
 * actually uses — not a general-purpose typing of either package.
 */

declare module '@codesandbox/sandpack-client' {
  export interface ClientOptions {
    bundlerURL?: string
    logLevel?: number
    showOpenInCodeSandbox?: boolean
    [key: string]: unknown
  }

  export interface SandboxSetup {
    files: Record<string, { code: string }>
    dependencies?: Record<string, string>
    entry?: string
    [key: string]: unknown
  }

  export interface SandpackClient {
    listen(listener: (message: { type: string } & Record<string, unknown>) => void): () => void
    destroy(): void
    [key: string]: unknown
  }

  export function loadSandpackClient(
    iframeSelector: string | HTMLIFrameElement,
    sandboxSetup: SandboxSetup,
    options?: ClientOptions
  ): Promise<SandpackClient>
}

declare module 'esbuild' {
  export interface BuildOptions {
    entryPoints: string[]
    bundle?: boolean
    write?: boolean
    format?: 'iife' | 'cjs' | 'esm'
    platform?: 'browser' | 'node' | 'neutral'
    target?: string | string[]
    plugins?: EsbuildPlugin[]
    define?: Record<string, string>
    [key: string]: unknown
  }

  export interface OutputFile {
    text: string
    contents: Uint8Array
    path: string
  }

  export interface BuildResult {
    outputFiles?: OutputFile[]
    [key: string]: unknown
  }

  export interface EsbuildPluginBuild {
    onResolve(
      options: { filter: RegExp },
      callback: (args: { path: string }) => { path: string } | undefined | void
    ): void
    onLoad(
      options: { filter: RegExp },
      callback: (args: { path: string }) => unknown
    ): void
  }

  export interface EsbuildPlugin {
    name: string
    setup(build: EsbuildPluginBuild): void
  }

  export function build(options: BuildOptions): Promise<BuildResult>
}

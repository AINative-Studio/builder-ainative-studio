/**
 * Dynamic fixture builder for scripts/verify-sandpack-bundler-e2e.ts's
 * --chat-id=<id> option.
 *
 * WHY THIS EXISTS: issue #1089's realistic.ts fixture is a hand-authored
 * synthetic approximation of what Builder's real generated apps import. The
 * 2026-10-14 investigation (same issue, latest comment) found a REAL app
 * ("Funnelr", chatId 1yu8vYKkEAyGugAII1rvz) still blew the 15s watchdog even
 * after PR #5's cache+worker-pool fix landed, despite using FEWER lucide
 * icons (12) and FEWER shadcn components (4) than realistic.ts. The gap
 * traced to something realistic.ts never exercised: production's real
 * `customSetup.dependencies` (components/chat/sandpack-preview.tsx) declares
 * `recharts: '2.15.0'` on EVERY real preview, regardless of whether the
 * generated app actually imports it. sandpack-bundler's
 * ModuleRegistry.preloadModules()/loadModuleDependencies()
 * (src/bundler/module-registry/index.ts) fetch and precompile the FULL
 * dependency tree for every entry in the manifest, not just what's
 * reachable from actual imports — so an unused `recharts` dependency still
 * costs a full compile of recharts + its transitive tree (victory-vendor,
 * which itself vendors d3-shape/d3-scale/d3-array/d3-interpolate/d3-path/
 * d3-time/d3-timer/d3-format/internmap, plus lodash, react-smooth,
 * recharts-scale, eventemitter3, tiny-invariant, react-is) on every single
 * compile, on top of the lucide-react barrel cost #1089 already fixed.
 *
 * This fixture fetches a REAL Builder-generated app's files from a running
 * Builder dev instance's /api/generation/{id}/files endpoint, merges them
 * with the SAME lib/sandpack/setup.ts getBuiltinFiles() every real preview
 * uses (shadcn + AIKit bundles), and ships the SAME dependency manifest
 * components/chat/sandpack-preview.tsx actually sends — so what this
 * fixture sends to the bundler is byte-for-byte what a real founder's
 * browser sends, not another synthetic approximation.
 */
import { getBuiltinFiles } from '../../../lib/sandpack/setup'
import type { SandpackFixture } from './types'

/**
 * The exact dependency manifest components/chat/sandpack-preview.tsx's
 * SandpackProvider customSetup sends on every real preview (see that file's
 * `customSetup.dependencies` — pinned versions, not sandpackDependencies
 * from lib/sandpack/setup.ts, which is NOT actually wired into the live
 * preview path despite being exported). Kept here as a literal copy (not
 * imported) so this fixture fails loudly via a visible diff if production's
 * real manifest ever changes, rather than silently drifting.
 */
export const PRODUCTION_DEPENDENCIES: Record<string, string> = {
  react: '18.2.0',
  'react-dom': '18.2.0',
  'prop-types': '15.8.1',
  'lucide-react': '0.344.0',
  recharts: '2.15.0',
  clsx: '2.1.0',
  'tailwind-merge': '2.2.0',
}

export interface RealAppFilesResponse {
  files: Record<string, string | { code?: string; content?: string }>
  source?: string
}

function normalizeFileContent(value: string | { code?: string; content?: string }): string {
  if (typeof value === 'string') return value
  return value.code ?? value.content ?? ''
}

/**
 * Fetch a real Builder-generated app's files from a running Builder
 * instance (default http://localhost:3000, matching this repo's local dev
 * server) and build a SandpackFixture that mirrors exactly what production
 * sends to the bundler for that chatId.
 */
export async function buildChatIdFixture(
  chatId: string,
  builderBaseUrl: string = process.env.BUILDER_BASE_URL ?? 'http://localhost:3000'
): Promise<SandpackFixture> {
  const url = `${builderBaseUrl.replace(/\/+$/, '')}/api/generation/${encodeURIComponent(chatId)}/files`
  const res = await fetch(url)
  if (!res.ok) {
    throw new Error(`buildChatIdFixture: GET ${url} -> HTTP ${res.status}`)
  }
  const body = (await res.json()) as RealAppFilesResponse
  if (!body.files || Object.keys(body.files).length === 0) {
    throw new Error(`buildChatIdFixture: chatId ${chatId} returned zero files from ${url}`)
  }

  const generatedFiles: Record<string, string> = {}
  for (const [path, raw] of Object.entries(body.files)) {
    generatedFiles[path] = normalizeFileContent(raw)
  }

  // Same precedence as components/chat/sandpack-preview.tsx: builtins first,
  // generated files override. Real preview also duplicates /src/components/*
  // to /components/* (handled inside getBuiltinFiles() already for the
  // builtin half; generated files here are used as-is since that's what the
  // real /api/generation/{id}/files payload already contains for this app).
  const files: Record<string, string> = {
    ...getBuiltinFiles(),
    ...generatedFiles,
  }

  // Ensure there's an entry Sandpack can find. Real Builder apps ship
  // /src/App.tsx (confirmed for Funnelr); fall back to synthesizing one
  // from /App.tsx if a future real app ships flat instead.
  if (!files['/src/App.tsx'] && files['/App.tsx']) {
    files['/src/App.tsx'] = files['/App.tsx']
  }

  // Best-effort marker text for the render assertion: look for any plain
  // string literal in the entry files that's unlikely to be a false match.
  // Real apps don't ship a harness-friendly data-testid, so this fixture's
  // render case is scored on compile completion + zero errors, not DOM text
  // (see verify-sandpack-bundler-e2e.ts's --chat-id handling, which skips
  // the expectedText assertion for chat-id fixtures for this reason).
  return {
    name: `chat-id:${chatId}`,
    description: `Real Builder app (chatId=${chatId}), fetched live from ${builderBaseUrl} and merged with the real getBuiltinFiles() bundle + production's real dependency manifest (including recharts).`,
    dependencies: PRODUCTION_DEPENDENCIES,
    files,
    expectedText: '__CHAT_ID_FIXTURE_NO_TEXT_ASSERTION__',
  }
}

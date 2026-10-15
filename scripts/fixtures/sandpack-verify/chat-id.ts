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
 * `customSetup.dependencies` (components/chat/sandpack-preview.tsx) declared
 * `recharts: '2.15.0'` on EVERY real preview at the time, regardless of
 * whether the generated app actually imported it — fixed in #1097 to be
 * conditional (see detectSandpackDependencies below, which is the SAME
 * logic that fix now uses).
 *
 * This fixture fetches a REAL Builder-generated app's files from a running
 * Builder instance's /api/generation/{id}/files endpoint and runs them
 * through the EXACT SAME lib/sandpack/build-files.ts pipeline
 * components/chat/sandpack-preview.tsx uses (builtins merge, path
 * normalization, React/AIKit/shadcn/lucide import-injection safety nets,
 * final de-dupe, then conditional lucide-react/recharts dependency
 * detection) — so what this fixture sends to the bundler is byte-for-byte
 * what a real founder's browser sends, not another synthetic approximation.
 *
 * 2026-10-15 fix: this fixture previously hand-rolled its own builtins-merge
 * and shipped a hardcoded, always-on `recharts`/`lucide-react` dependency
 * literal, completely skipping sandpack-preview.tsx's shadcn/lucide
 * import-injection safety net. That produced false FAILs during the #1089
 * overnight spot-check loop — 3 of 5 real apps "failed" with e.g. "Separator
 * is not defined" in this harness while rendering with zero console errors
 * on the real live /preview/{id} page, because only the real page's
 * SandpackPreview component ran the injection that adds the missing
 * `import { Separator } from './components/ui/separator'` line. Routing
 * through the shared lib/sandpack/build-files.ts pipeline (extracted from
 * sandpack-preview.tsx for exactly this reason) means this harness can
 * never drift out of sync with what production actually does again.
 */
import { buildSandpackFiles, detectSandpackDependencies } from '../../../lib/sandpack/build-files'
import type { SandpackFixture } from './types'

const ALWAYS_ON_DEPENDENCIES: Record<string, string> = {
  react: '18.2.0',
  'react-dom': '18.2.0',
  'prop-types': '15.8.1',
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

  // Run through the EXACT same pipeline components/chat/sandpack-preview.tsx
  // uses: builtins merge, path normalization, /App.tsx entry assembly, and
  // the React/AIKit/shadcn/lucide import-injection safety nets + final
  // de-dupe. This is what makes the fixture byte-for-byte what a real
  // founder's browser sends — see this file's top doc comment for the real
  // false-FAIL bug this replaced.
  const files = buildSandpackFiles(generatedFiles)
  const { usesLucideReact, usesRecharts } = detectSandpackDependencies(files)
  const dependencies: Record<string, string> = {
    ...ALWAYS_ON_DEPENDENCIES,
    ...(usesLucideReact ? { 'lucide-react': '0.344.0' } : {}),
    ...(usesRecharts ? { recharts: '2.15.0' } : {}),
  }

  // Best-effort marker text for the render assertion: look for any plain
  // string literal in the entry files that's unlikely to be a false match.
  // Real apps don't ship a harness-friendly data-testid, so this fixture's
  // render case is scored on compile completion + zero errors, not DOM text
  // (see verify-sandpack-bundler-e2e.ts's --chat-id handling, which skips
  // the expectedText assertion for chat-id fixtures for this reason).
  return {
    name: `chat-id:${chatId}`,
    description: `Real Builder app (chatId=${chatId}), fetched live from ${builderBaseUrl} and run through the real build-files.ts pipeline + conditional dependency detection (#1097).`,
    dependencies,
    files,
    expectedText: '__CHAT_ID_FIXTURE_NO_TEXT_ASSERTION__',
  }
}

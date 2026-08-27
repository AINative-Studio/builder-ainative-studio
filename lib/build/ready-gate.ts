/**
 * Ready gate (builder#77) — the pre-deploy PARSE GATE applied at the "mark ready"
 * seam. Before a brand slug is registered/deployed to its shareable URL, we resolve
 * the generated app's actual stored code (in-memory preview store first, then the
 * durable ZeroDB copy) and run the authoritative parse gate (isRenderable) on it.
 *
 * If the app fails to parse / references a hallucinated component / etc., the
 * caller MUST NOT mark it ready — it should surface an honest "generation failed,
 * retrying" state rather than shipping a Syntax-Error page or an empty frame (the
 * quad college-social-app bug).
 *
 * builder#333 adds the COMPLETENESS GATE on top: a truncated multi-file
 * generation (the beacon repro — App imports Analytics but the stream was cut
 * before Analytics was emitted) can pass the parse gate file-by-file yet still
 * be unshippable. findMissingLocalImports proves the payload actually contains
 * every local component it imports; a flagged app is treated exactly like a
 * parse failure (422 → client auto-retries) instead of persisting a broken app.
 *
 * The gate resolves code from the SAME sources the /api/preview/[id] renderer uses,
 * so its verdict matches what the browser will actually try to run.
 */

import { getPreview } from '@/lib/preview-store'
import { getFiles as getFilesV2 } from '@/lib/preview-store-v2'
import { isRenderable, type ParseGateResult } from '@/lib/code-validator'
import { findMissingLocalImports } from '@/lib/build/completeness-gate'
import { flattenMultiFile } from '@/lib/build/flatten-multifile'
import { parse as babelParse } from '@babel/parser'

export interface ReadyCheck extends ParseGateResult {
  /** True when we found stored code to check. False → cannot verify (fail-open). */
  checked: boolean
}

interface StoredApp {
  code: string
  /** The multi-file map when one is available (in-memory V2 store or durable files_json). */
  files: Record<string, string> | null
}

/**
 * Resolve a chatId's stored generated code (and, when available, its multi-file
 * map) from the durable/in-memory stores. In-memory preview store is fastest;
 * ZeroDB is the durable source of truth that survives restarts (register-app
 * can run long after generation, in another process). Returns null if neither
 * store has content.
 */
async function resolveStoredApp(chatId: string): Promise<StoredApp | null> {
  // The in-memory V2 store holds the parsed files map from this instance's
  // generation — best-effort in both branches (never required).
  let memFiles: Record<string, string> | null = null
  try {
    memFiles = getFilesV2(chatId)
  } catch {
    /* files map unavailable — the code-only checks still run */
  }

  // 1) In-memory preview store (populated during generation / on prior render).
  const mem = getPreview(chatId)
  if (mem && mem.trim()) return { code: mem, files: memFiles }

  // 2) Durable ZeroDB copy. Dynamic import keeps this off the hot path and avoids
  //    pulling the ZeroDB client into modules that never need it.
  try {
    const { loadGeneration } = await import('@/lib/zerodb-store')
    const gen = await loadGeneration(chatId)
    if (gen?.generatedCode && gen.generatedCode.trim()) {
      return { code: gen.generatedCode, files: gen.files || memFiles }
    }
  } catch {
    /* durable store unavailable — fall through to fail-open */
  }

  return null
}

/**
 * Run the pre-deploy parse gate for a chatId's generated app.
 *
 * FAIL-OPEN on "can't find code": if neither store has the code (e.g. transient
 * ZeroDB hiccup, or the caller races generation), we return { checked: false,
 * ok: true } so a store outage never blocks a legitimate app. The gate only
 * BLOCKS when it has real code that it can prove is broken — a false block is
 * worse than letting an unverifiable app through, because generation-time
 * validation is the primary guard and this is defense-in-depth.
 */
export async function checkAppReady(chatId: string): Promise<ReadyCheck> {
  const stored = await resolveStoredApp(chatId)
  if (stored === null) {
    // Nothing to verify — don't block on a store miss.
    return { checked: false, ok: true }
  }

  const gate = isRenderable(stored.code)
  if (!gate.ok) return { checked: true, ...gate }

  // Completeness gate (#333): the code parses, but is every local component it
  // imports actually IN the payload? A truncated generation (Analytics imported,
  // never emitted) must not be marked ready — same retry path as a parse failure.
  const missing = findMissingLocalImports(stored.code, stored.files ?? undefined)
  if (missing.length > 0) {
    return {
      checked: true,
      ok: false,
      reason: 'missing_local_import',
      error: `Truncated generation: imported local module(s) never defined in the payload: ${missing.join(', ')}`,
    }
  }

  // FLATTENED-PARSE GATE (aerosol repro, 2026-08-27): a generation truncated
  // MID-FILE (JSX cut off inside a component — code jumps from an open <div>
  // to "));}}") resolves every import, and isRenderable missed the imbalance,
  // but the flattened blob the browser actually runs fails to parse. Prove the
  // exact artifact the preview serves parses — this is deterministic for both
  // the beacon and aerosol truncation shapes.
  try {
    babelParse(flattenMultiFile(stored.code), { sourceType: 'module', plugins: ['jsx'] })
  } catch (e) {
    const msg = e instanceof Error ? e.message.split('\n')[0] : String(e)
    return {
      checked: true,
      ok: false,
      reason: 'syntax_error',
      error: `Truncated/unbalanced generation (flattened parse): ${msg}`,
    }
  }

  return { checked: true, ok: true }
}

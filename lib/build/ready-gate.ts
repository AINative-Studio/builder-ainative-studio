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
 * The gate resolves code from the SAME sources the /api/preview/[id] renderer uses,
 * so its verdict matches what the browser will actually try to run.
 */

import { getPreview } from '@/lib/preview-store'
import { isRenderable, type ParseGateResult } from '@/lib/code-validator'

export interface ReadyCheck extends ParseGateResult {
  /** True when we found stored code to check. False → cannot verify (fail-open). */
  checked: boolean
}

/**
 * Resolve a chatId's stored generated code from the durable/in-memory stores.
 * In-memory preview store is fastest; ZeroDB is the durable source of truth that
 * survives restarts (register-app can run long after generation, in another
 * process). Returns the raw content (markdown / multi-file blob / raw code) or null.
 */
async function resolveStoredCode(chatId: string): Promise<string | null> {
  // 1) In-memory preview store (populated during generation / on prior render).
  const mem = getPreview(chatId)
  if (mem && mem.trim()) return mem

  // 2) Durable ZeroDB copy. Dynamic import keeps this off the hot path and avoids
  //    pulling the ZeroDB client into modules that never need it.
  try {
    const { loadGeneration } = await import('@/lib/zerodb-store')
    const gen = await loadGeneration(chatId)
    if (gen?.generatedCode && gen.generatedCode.trim()) return gen.generatedCode
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
  const code = await resolveStoredCode(chatId)
  if (code === null) {
    // Nothing to verify — don't block on a store miss.
    return { checked: false, ok: true }
  }
  const gate = isRenderable(code)
  return { checked: true, ...gate }
}

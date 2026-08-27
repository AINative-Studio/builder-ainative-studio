/**
 * GET /api/generation/{id}/files (#333) — the durable read path for a
 * generation's multi-file map.
 *
 * The SSE `files` event only exists on the live generating stream; before this
 * route, a reload (or a different instance) lost the map and multi-file apps
 * could never take the Sandpack path again — they fell back to flattenMultiFile
 * on the concatenated blob. This route serves the map from the in-memory V2
 * store (same-instance fast path) or the durable ZeroDB copy (files_json,
 * persisted by saveGeneration), so the workspace client can rehydrate the
 * Sandpack path from anywhere.
 *
 * Response: { files: Record<string, string> } · 404 { files: null } when no
 * map exists (single-file apps never persist one — Babel restores them from
 * generated_code alone).
 */

import { NextRequest } from 'next/server'
import { getFiles as getFilesV2 } from '@/lib/preview-store-v2'

export const runtime = 'nodejs'

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params
  const chatId = (id || '').slice(0, 64)
  if (!chatId) return Response.json({ files: null }, { status: 400 })

  // 1) In-memory V2 store — populated by this instance's generation.
  try {
    const mem = getFilesV2(chatId)
    if (mem && Object.keys(mem).length > 0) {
      return Response.json({ files: mem, source: 'memory' })
    }
  } catch {
    /* in-memory miss — consult the durable store */
  }

  // 2) Durable ZeroDB copy (survives restarts / other instances).
  try {
    const { loadGeneration } = await import('@/lib/zerodb-store')
    const gen = await loadGeneration(chatId)
    if (gen?.files && Object.keys(gen.files).length > 0) {
      return Response.json({ files: gen.files, source: 'durable' })
    }
  } catch {
    /* durable store unavailable — report not-found below */
  }

  return Response.json({ files: null }, { status: 404 })
}

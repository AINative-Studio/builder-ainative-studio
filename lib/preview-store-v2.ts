/**
 * Preview Store V2 — stores Sandpack file maps instead of HTML blobs.
 * Uses global Map for dev hot-reload persistence.
 * 2-hour TTL with lazy cleanup.
 */

interface SessionData {
  files: Record<string, string>
  metadata?: { usage?: any; [key: string]: any }
  createdAt: string
  expiresAt: number
}

declare global {
  var __previewStoreV2: Map<string, SessionData> | undefined
}

const TTL_MS = 2 * 60 * 60 * 1000 // 2 hours

const store = global.__previewStoreV2 || new Map<string, SessionData>()
if (!global.__previewStoreV2) {
  global.__previewStoreV2 = store
}

/** Remove expired sessions */
function cleanup() {
  const now = Date.now()
  for (const [id, data] of store) {
    if (data.expiresAt < now) {
      store.delete(id)
    }
  }
}

/** Store files for a session */
export function storeFiles(
  id: string,
  files: Record<string, string>,
  metadata?: { usage?: any; [key: string]: any }
): void {
  cleanup()
  store.set(id, {
    files,
    metadata,
    createdAt: new Date().toISOString(),
    expiresAt: Date.now() + TTL_MS,
  })
  console.log(`[PreviewStoreV2] Stored ${Object.keys(files).length} files for ${id}, total sessions: ${store.size}`)
}

/** Get files for a session */
export function getFiles(id: string): Record<string, string> | null {
  cleanup()
  const data = store.get(id)
  return data?.files || null
}

/** Get metadata for a session */
export function getMetadata(id: string): any {
  const data = store.get(id)
  return data?.metadata || null
}

/** List all active sessions */
export function listSessions(): Array<{ id: string; createdAt: string; fileCount: number }> {
  cleanup()
  return Array.from(store.entries()).map(([id, data]) => ({
    id,
    createdAt: data.createdAt,
    fileCount: Object.keys(data.files).length,
  }))
}

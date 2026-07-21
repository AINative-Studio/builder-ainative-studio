/**
 * Client helper: create a Project for a freshly generated app, under the
 * user's active workspace. Each generated app IS a core Project (1 app = 1
 * project). Called once per new chat from the generation "complete" handler.
 *
 * Fire-and-forget by design — a project-linking failure must never break the
 * generation UX. Returns the created project id, or a structured result when
 * the free-tier cap is hit so the caller can prompt an upgrade.
 */
import { getActiveWorkspaceId } from '@/components/workspace-switcher'

export interface LinkProjectResult {
  ok: boolean
  projectId?: string
  upgradeRequired?: boolean
  max?: number
  error?: string
}

/** Derive a short, human project name from the generation prompt. */
export function projectNameFromPrompt(prompt: string): string {
  const cleaned = (prompt || '').replace(/\s+/g, ' ').trim()
  if (!cleaned) return 'Untitled App'
  const firstClause = cleaned.split(/[.!?\n]/)[0]
  const name = firstClause.length > 60 ? `${firstClause.slice(0, 57)}…` : firstClause
  return name.charAt(0).toUpperCase() + name.slice(1)
}

/**
 * Create a project for this generated app. `chatId` is recorded so the app and
 * its core Project stay linked. Safe to call even if the user is not an
 * AINative account — the API returns 401 and we no-op.
 */
export async function createProjectForApp(params: {
  prompt: string
  chatId?: string
}): Promise<LinkProjectResult> {
  try {
    const res = await fetch('/api/projects', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: projectNameFromPrompt(params.prompt),
        description: params.prompt?.slice(0, 1000) || undefined,
        workspaceId: getActiveWorkspaceId() || undefined,
        chatId: params.chatId,
      }),
    })
    const body = await res.json().catch(() => ({}))

    if (res.ok) {
      return { ok: true, projectId: body.project?.id }
    }
    if (res.status === 401) {
      // Not an AINative session — nothing to link. Silent no-op.
      return { ok: false }
    }
    if (body.upgradeRequired) {
      return { ok: false, upgradeRequired: true, max: body.max }
    }
    return { ok: false, error: body.error || `Failed (${res.status})` }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Request failed' }
  }
}

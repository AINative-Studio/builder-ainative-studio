/**
 * AINative workspace client — consumes the core workspace API
 * (app/api/v1/consolidated/workspaces.py). A "workspace" is a core
 * Organization; every AINative user has a permanent default workspace
 * (is_default=true), so this list is never empty for a real account.
 */
import { ainativeFetch } from './client'
import type {
  Workspace,
  WorkspaceCreateInput,
  WorkspaceListResponse,
} from './types'

/** GET /api/v1/workspaces — all workspaces the user belongs to. */
export async function listWorkspaces(accessToken: string): Promise<Workspace[]> {
  const res = await ainativeFetch<WorkspaceListResponse>(
    '/api/v1/workspaces',
    accessToken,
  )
  return res?.workspaces ?? []
}

/** The user's canonical default workspace (is_default), else the first one. */
export async function getDefaultWorkspace(
  accessToken: string,
): Promise<Workspace | null> {
  const workspaces = await listWorkspaces(accessToken)
  if (workspaces.length === 0) return null
  return workspaces.find((w) => w.is_default) ?? workspaces[0]
}

/** POST /api/v1/workspaces — create a new workspace. */
export async function createWorkspace(
  accessToken: string,
  input: WorkspaceCreateInput,
): Promise<Workspace> {
  const res = await ainativeFetch<{ ok: boolean; workspace: Workspace }>(
    '/api/v1/workspaces',
    accessToken,
    { method: 'POST', body: input },
  )
  return res.workspace
}

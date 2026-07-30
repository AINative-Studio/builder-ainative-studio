/**
 * AINative project client — consumes the core project API
 * (app/zerodb/api/project_router.py). In the builder, each generated app IS a
 * core Project (1 app = 1 project), scoped to a workspace via organization_id.
 *
 * If organization_id is omitted on create, core resolves it to the user's
 * default workspace, so a project is never born orphaned.
 */
import { ainativeFetch } from './client'
import {
  HOBBYIST_MAX_PROJECTS,
  type Project,
  type ProjectCreateInput,
} from './types'

/** GET /api/v1/projects — the user's projects (apps). */
export async function listProjects(accessToken: string): Promise<Project[]> {
  const res = await ainativeFetch<Project[] | { projects: Project[] }>(
    '/api/v1/projects',
    accessToken,
  )
  // Core returns a bare array; tolerate a wrapped shape defensively.
  return Array.isArray(res) ? res : (res?.projects ?? [])
}

/** Projects scoped to a single workspace. */
export async function listProjectsForWorkspace(
  accessToken: string,
  organizationId: string,
): Promise<Project[]> {
  const all = await listProjects(accessToken)
  return all.filter((p) => p.organization_id === organizationId)
}

/** GET /api/v1/projects/{id} */
export async function getProject(
  accessToken: string,
  projectId: string,
): Promise<Project> {
  return ainativeFetch<Project>(`/api/v1/projects/${projectId}`, accessToken)
}

/** POST /api/v1/projects — create a project (= a generated app). */
export async function createProject(
  accessToken: string,
  input: ProjectCreateInput,
): Promise<Project> {
  return ainativeFetch<Project>('/api/v1/projects', accessToken, {
    method: 'POST',
    body: {
      database_enabled: true,
      tier: 'free',
      ...input,
    },
  })
}

/** DELETE /api/v1/projects/{id} (soft delete in core). */
export async function deleteProject(
  accessToken: string,
  projectId: string,
): Promise<void> {
  await ainativeFetch<unknown>(`/api/v1/projects/${projectId}`, accessToken, {
    method: 'DELETE',
  })
}

/**
 * How many more projects a Hobbyist user can create. Core caps the Hobbyist
 * (entry, $5/7-day-trial) tier at 3 projects — surfacing this in the UI turns
 * the limit into an upgrade prompt rather than a silent 4xx on create.
 */
export function hobbyistProjectsRemaining(projectCount: number): number {
  return Math.max(0, HOBBYIST_MAX_PROJECTS - projectCount)
}
/** @deprecated legacy name — use hobbyistProjectsRemaining. */
export const freeTierProjectsRemaining = hobbyistProjectsRemaining

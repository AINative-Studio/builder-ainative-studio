/**
 * AINative core data-model types — mirrors the FastAPI/Pydantic shapes in
 * ~/core/src/backend/app so the builder stays aligned with the core backend.
 *
 * Workspace == the `organizations` table (Organization model).
 * Project   == the `projects` table, associated to a workspace via
 *              projects.organization_id -> organizations.id.
 *
 * A generated app in the builder IS a core Project (1 app = 1 project).
 */

export type WorkspaceRole = 'MEMBER' | 'OWNER' | 'ADMIN'
export type WorkspaceType = 'personal' | 'client' | 'team'
export type WorkspaceTier = 'free' | 'pro' | 'team' | 'enterprise'

export type ProjectTier = 'free' | 'pro' | 'scale' | 'enterprise'
export type ProjectStatus = 'ACTIVE' | 'SUSPENDED' | 'DELETED'

/** Mirrors WorkspaceItem in app/api/v1/consolidated/workspaces.py */
export interface Workspace {
  id: string
  name: string
  description?: string | null
  tier: WorkspaceTier
  domain?: string | null
  role: WorkspaceRole
  is_default: boolean
  workspace_type: WorkspaceType
  member_count: number
  project_count: number
  created_at: string
}

/** Mirrors WorkspaceListResponse */
export interface WorkspaceListResponse {
  ok: boolean
  workspaces: Workspace[]
  total: number
}

/** Mirrors WorkspaceCreateRequest */
export interface WorkspaceCreateInput {
  name: string
  description?: string
  tier?: WorkspaceTier
  workspace_type?: WorkspaceType
}

/** Mirrors ProjectResponse in app/zerodb/api/project_router.py */
export interface Project {
  id: string
  name: string
  description?: string | null
  tier: ProjectTier
  status: ProjectStatus
  user_id: string
  /** Workspace FK — organization_id -> organizations.id */
  organization_id?: string | null
  organization_name?: string | null
  database_enabled: boolean
  vector_dimensions: number
  quantum_enabled: boolean
  mcp_enabled: boolean
  database_config: Record<string, unknown>
  railway_project_id?: string | null
  created_at: string
  updated_at: string
}

/** Mirrors ProjectCreate. organization_id omitted => core resolves to the
 *  user's default workspace, so a project is never born orphaned. */
export interface ProjectCreateInput {
  name: string
  description?: string
  tier?: ProjectTier
  database_enabled?: boolean
  /** Workspace this project belongs to. */
  organization_id?: string
}

/** Free-tier project cap enforced by core (get_tier_limits: free => 3). */
export const FREE_TIER_MAX_PROJECTS = 3

export class AINativeApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: unknown,
  ) {
    super(message)
    this.name = 'AINativeApiError'
  }
}

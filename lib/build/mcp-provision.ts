/**
 * Build-time ZeroDB MCP wedge (#73, phase 1).
 *
 * This is the highest-impact, most demoable slice of the "Cody OPERATES primitives"
 * strategy: during a build, Cody CALLS the ZeroDB MCP server (69 tools) to create a
 * REAL project + tables, so a generated app's preview reads/writes a real,
 * MCP-provisioned ZeroDB instead of a mock.
 *
 * Competitors only GENERATE code that calls an API. Here Cody agentically drives the
 * primitive through its MCP tool surface (`zerodb_create_project`, `zerodb_create_table`)
 * — the strategic differentiator.
 *
 * SAFETY / GATING (never break the build):
 *  - Inert unless BOTH the flag (ENABLE_MCP_PROVISION=1/true) is set AND an MCP key
 *    is configured. Otherwise `provisionZeroDbViaMcp` returns `{ ok:false, skipped:true }`
 *    and the caller falls back to the existing Instant-DB REST path.
 *  - All failures are swallowed into a structured result — this function NEVER throws.
 *  - No secrets are logged; the MCP key comes from env only.
 *
 * This module owns ONLY the ZeroDB build-time seam (phase-1 goal: one primitive
 * end-to-end). Run-time ops (GTM/ZeroVoice/etc.) are later phases.
 */

import { logger } from '../logger'
import { AiNativeMcpClient, type McpToolResult } from '../mcp/ainative-mcp-client'
import { getMcpServer } from './primitive-catalog'

/** A table Cody should create for the generated app. */
export interface McpTableSpec {
  name: string
  /** Column definitions passed straight to `zerodb_create_table`. */
  columns?: Record<string, unknown>[]
  /** Free-form schema/description for servers that accept it. */
  schema?: Record<string, unknown>
}

export interface McpProvisionInput {
  /** Company slug (used to name the project deterministically). */
  slug: string
  /** Display name for the project. */
  name?: string
  /** Tables to create (optional — a project alone is still useful). */
  tables?: McpTableSpec[]
  /** Injected client (tests). When omitted, one is built from the ZeroDB server ref. */
  client?: AiNativeMcpClient
}

export interface McpProvisionResult {
  ok: boolean
  /** True when the wedge was intentionally inert (flag off / no creds). Not an error. */
  skipped?: boolean
  reason?: string
  /** Real ZeroDB project id created via MCP, when successful. */
  projectId?: string
  /** Names of tables successfully created via MCP. */
  tablesCreated?: string[]
}

/** Is the build-time MCP wedge enabled? Gated by env so it's inert + safe by default. */
export function isMcpProvisionEnabled(): boolean {
  const flag = (typeof process !== 'undefined' && process.env?.ENABLE_MCP_PROVISION) || ''
  return flag === '1' || flag.toLowerCase() === 'true'
}

/** Pull the created project id out of an MCP tool result (servers vary in shape). */
export function extractProjectId(result: McpToolResult): string | undefined {
  if (!result || result.isError) return undefined
  // 1. structuredContent (preferred, when present).
  const structured = result.structuredContent as Record<string, unknown> | undefined
  const fromStructured =
    (structured?.project_id as string) ||
    (structured?.projectId as string) ||
    (structured?.id as string)
  if (fromStructured) return fromStructured
  // 2. Text content block carrying JSON.
  const text = result.content?.find((b) => b.type === 'text')?.text
  if (text) {
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>
      const id =
        (parsed.project_id as string) || (parsed.projectId as string) || (parsed.id as string)
      if (id) return id
    } catch {
      /* not JSON — ignore */
    }
  }
  return undefined
}

/**
 * Provision a REAL ZeroDB project (and optional tables) by driving the ZeroDB MCP
 * server as agentic tools. Inert + safe when the flag is off or creds are missing.
 * NEVER throws.
 */
export async function provisionZeroDbViaMcp(input: McpProvisionInput): Promise<McpProvisionResult> {
  if (!isMcpProvisionEnabled()) {
    return { ok: false, skipped: true, reason: 'flag_disabled' }
  }

  const server = getMcpServer('zerodb')
  if (!server) {
    return { ok: false, skipped: true, reason: 'no_zerodb_server' }
  }

  const client = input.client ?? new AiNativeMcpClient({ server })
  if (!client.isConfigured()) {
    return { ok: false, skipped: true, reason: 'not_configured' }
  }

  try {
    if (!client.isConnected()) {
      const connected = await client.connect()
      if (!connected) return { ok: false, skipped: true, reason: 'connect_failed' }
    }

    const projectName = (input.name || input.slug || 'cody-app').slice(0, 64)
    const createRes = await client.callTool('zerodb_create_project', {
      name: projectName,
      description: `Cody-provisioned project for ${input.slug}`,
    })
    if (createRes.isError) {
      return { ok: false, reason: 'create_project_failed' }
    }
    const projectId = extractProjectId(createRes)
    if (!projectId) {
      return { ok: false, reason: 'no_project_id' }
    }

    const tablesCreated: string[] = []
    for (const table of input.tables ?? []) {
      const tRes = await client.callTool('zerodb_create_table', {
        project_id: projectId,
        table_name: table.name,
        columns: table.columns,
        schema: table.schema,
      })
      if (!tRes.isError) {
        tablesCreated.push(table.name)
      } else {
        // A single table failure shouldn't discard a successfully created project.
        logger.warn(`MCP table create failed for ${table.name} in project ${projectId}`)
      }
    }

    logger.info(
      `MCP-provisioned ZeroDB project ${projectId} for ${input.slug} (${tablesCreated.length} tables)`,
    )
    return { ok: true, projectId, tablesCreated }
  } catch (error) {
    // Defensive: the client already swallows most failures, but never let this
    // escape and break a build.
    logger.error(`MCP ZeroDB provisioning threw for ${input.slug}`, error as Error)
    return { ok: false, reason: 'exception' }
  }
}

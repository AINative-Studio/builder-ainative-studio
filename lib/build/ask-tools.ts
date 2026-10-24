/**
 * Real tool_use tools for the Live-dashboard "Ask Cody" chat (#1188).
 *
 * Why this exists: a founder asking "what's in my products table" on the Live
 * dashboard (app/api/build/ask/route.ts) got an answer Cody invented from the
 * system prompt's static context — there was no way for the model to look at
 * the company's ACTUAL data or brand before answering. `lib/mcp/*` already has
 * two MCP-client prototypes (zerodb-client.ts, design-system-client.ts), but
 * neither is safe to wire here: zerodb-client.ts talks to a single env-wide
 * ZERODB_PROJECT_ID (wrong project for a per-company query — would leak
 * cross-tenant data or 403), and design-system-client.ts defaults to
 * `http://localhost:8001/extract`, a dev-only endpoint with no production
 * deployment. Both have zero production callers today.
 *
 * Instead, these two tools call the SAME real, already-live data paths this
 * route (and app/api/db/[table]/route.ts) already trust for this exact
 * per-company scoping problem:
 *  - queryZerodbTable reuses resolveCompanyZerodbKey (#806/#844) — the
 *    project-scoped key store that fixed the real cross-tenant 403/data-loss
 *    incident — so a tool call can never read another company's rows.
 *  - getDesignTokens reads the company's own real, durably-stored brand
 *    fields (AppEntry.color/logoUrl, #492) via resolveApp — genuine founder
 *    data, not a fabricated or dormant client.
 *
 * Every function here returns a small, LLM-readable result object; failures
 * are returned as `{ error }` strings, never thrown, so a tool failure can
 * never crash the chat turn — the model just sees an honest error and can
 * tell the founder it couldn't look that up.
 */

import { resolveAppVerified } from '@/lib/build/app-registry'
import { resolveCompanyZerodbKey } from '@/lib/build/company-zerodb-credentials'
import { getAinativeApiKey } from '@/lib/build/env-keys'

const ZERODB_API = process.env.AINATIVE_API_URL
  ? `${process.env.AINATIVE_API_URL}/api`
  : 'https://api.ainative.studio/api'
const SHARED_PROJECT_ID = process.env.ZERODB_PROJECT_ID || '5dfbc60c-7463-4e21-ac68-9bbe536f9adf'

/** Anthropic `tools` definitions for the two tools below. Kept deliberately
 *  small (#1188: "don't try to wire every conceivable MCP client in one PR") —
 *  a table read and a brand-tokens read cover the issue's acceptance example
 *  ("what's in my products table") and are the two pieces of real per-company
 *  data this route can already resolve safely. */
export const ASK_TOOL_DEFINITIONS = [
  {
    name: 'query_zerodb_table',
    description:
      "Reads real rows from a table in THIS company's own ZeroDB data project — e.g. " +
      '"products", "orders", "waitlist", "customers". Use this whenever the founder asks ' +
      "what data exists, how many rows/records there are, or what's actually stored " +
      "somewhere — never guess or invent table contents. Returns up to 20 real rows.",
    input_schema: {
      type: 'object',
      properties: {
        table: {
          type: 'string',
          description: 'The table name to read, exactly as the app uses it (e.g. "products").',
        },
        limit: {
          type: 'integer',
          description: 'Max rows to return (default 10, max 20).',
        },
      },
      required: ['table'],
    },
  },
  {
    name: 'get_design_tokens',
    description:
      "Reads this company's real, currently-saved brand/design tokens (brand color, logo). " +
      'Use this when the founder asks about their current brand color, logo, or visual identity ' +
      '— never invent a color or claim a logo exists without checking.',
    input_schema: {
      type: 'object',
      properties: {},
    },
  },
] as const

export interface AskToolContext {
  companyId: string
}

/** Resolve {projectId, apiKey} for a company's data plane, mirroring
 *  app/api/db/[table]/route.ts's resolveScope — the shared project's own key
 *  for the shared/legacy project, the company's OWN stored key otherwise.
 *  Never falls back to the shared key for a per-company project (#806/#844):
 *  that is precisely the cross-tenant mis-scoping this module must avoid.
 *
 *  Uses resolveAppVerified rather than resolveApp so a transient registry-read
 *  failure (`verified: false`) can never look identical to a genuinely
 *  unprovisioned company (`verified: true`, no entry) — the former must not
 *  silently fall through to the SHARED project, which is exactly the
 *  cross-tenant leak this function exists to prevent. */
async function resolveDataScope(
  companyId: string,
): Promise<{ projectId: string; apiKey: string } | { error: string }> {
  const { entry: app, verified } = await resolveAppVerified(companyId).catch(
    () => ({ entry: null as Awaited<ReturnType<typeof resolveAppVerified>>['entry'], verified: false }),
  )
  if (!verified) {
    return { error: "This company's data project could not be confirmed right now — try again in a moment." }
  }
  const projectId = app?.zerodbProjectId || SHARED_PROJECT_ID
  if (projectId === SHARED_PROJECT_ID) {
    const apiKey = getAinativeApiKey()
    if (!apiKey) return { error: 'ZeroDB is not configured in this environment.' }
    return { projectId, apiKey }
  }
  const resolved = await resolveCompanyZerodbKey(projectId)
  if (!resolved.ok || !resolved.apiKey) {
    return { error: `This company's data project key is unavailable (${resolved.reason || 'not_stored'}).` }
  }
  return { projectId, apiKey: resolved.apiKey }
}

/** Flatten a raw ZeroDB row ({row_data, row_id, ...}) to a flat object with a
 *  stable `id` — mirrors app/api/db/[table]/route.ts's flattenRow so a tool
 *  result reads the same shape generated-app code already expects. */
function flattenRow(row: any): any {
  if (!row || typeof row !== 'object') return row
  const hasRowData = row.row_data && typeof row.row_data === 'object'
  const inner = hasRowData ? row.row_data : {}
  const { row_data: _rd, row_id, created_at, updated_at, ...rest } = row
  const id = row_id ?? row.id ?? inner.id
  return {
    ...(hasRowData ? {} : rest),
    ...inner,
    ...(id !== undefined ? { id } : {}),
    ...(created_at !== undefined ? { created_at } : {}),
    ...(updated_at !== undefined ? { updated_at } : {}),
  }
}

export interface QueryZerodbTableResult {
  table: string
  rowCount: number
  rows: Record<string, unknown>[]
  error?: string
}

/**
 * Real tool_use handler: read up to `limit` rows from `table` in the
 * company's own ZeroDB project. Never throws — any failure (unconfigured,
 * unresolvable key, table doesn't exist yet, network error) comes back as
 * `{ error }` with an empty row set, so the model can tell the founder
 * honestly rather than fabricating contents.
 */
export async function queryZerodbTable(
  ctx: AskToolContext,
  args: { table?: string; limit?: number },
): Promise<QueryZerodbTableResult> {
  const table = String(args?.table || '').trim()
  if (!table) return { table: '', rowCount: 0, rows: [], error: 'table name is required' }
  const limit = Math.max(1, Math.min(20, Number(args?.limit) || 10))

  const scope = await resolveDataScope(ctx.companyId)
  if ('error' in scope) return { table, rowCount: 0, rows: [], error: scope.error }

  try {
    const res = await fetch(
      `${ZERODB_API}/v1/projects/${scope.projectId}/database/tables/${encodeURIComponent(table)}/rows?limit=${limit}`,
      { headers: { 'X-API-Key': scope.apiKey, 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(10000) },
    )
    if (!res.ok) {
      if (res.status === 404) {
        return { table, rowCount: 0, rows: [], error: `Table "${table}" does not exist yet — nothing has been written to it.` }
      }
      const text = await res.text().catch(() => '')
      return { table, rowCount: 0, rows: [], error: `ZeroDB error ${res.status}: ${text.slice(0, 200)}` }
    }
    const json = await res.json().catch(() => null)
    const rawRows = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : []
    const rows = rawRows.slice(0, limit).map(flattenRow)
    return { table, rowCount: rows.length, rows }
  } catch (e: any) {
    return { table, rowCount: 0, rows: [], error: `Request failed: ${String(e?.message || e).slice(0, 160)}` }
  }
}

export interface DesignTokensResult {
  hasBrandColor: boolean
  color?: string
  hasLogo: boolean
  logoUrl?: string
  logoUpdatedAt?: string
  error?: string
}

/**
 * Real tool_use handler: read the company's own currently-saved brand tokens
 * (AppEntry.color/logoUrl/logoUpdatedAt, #492) — genuine per-company data,
 * never a fabricated palette. Never throws.
 *
 * Distinguishes a confirmed miss from a failed lookup (resolveAppVerified):
 * a transient registry-read hiccup must never be told to the founder as the
 * flatly false "Company not found."
 */
export async function getDesignTokens(ctx: AskToolContext): Promise<DesignTokensResult> {
  try {
    const { entry: app, verified } = await resolveAppVerified(ctx.companyId)
    if (!verified) {
      return { hasBrandColor: false, hasLogo: false, error: 'Could not confirm this company right now — try again in a moment.' }
    }
    if (!app) {
      return { hasBrandColor: false, hasLogo: false, error: 'Company not found.' }
    }
    return {
      hasBrandColor: Boolean(app.color),
      color: app.color || undefined,
      hasLogo: Boolean(app.logoUrl),
      logoUrl: app.logoUrl || undefined,
      logoUpdatedAt: app.logoUpdatedAt || undefined,
    }
  } catch (e: any) {
    return { hasBrandColor: false, hasLogo: false, error: `Lookup failed: ${String(e?.message || e).slice(0, 160)}` }
  }
}

/**
 * Dispatch a single tool_use call by name. Returns a JSON-serializable result
 * (never throws) for direct use as an Anthropic tool_result content block's
 * `content`.
 */
export async function runAskTool(
  name: string,
  input: Record<string, unknown>,
  ctx: AskToolContext,
): Promise<{ result: unknown; isError: boolean }> {
  try {
    if (name === 'query_zerodb_table') {
      const r = await queryZerodbTable(ctx, input as { table?: string; limit?: number })
      return { result: r, isError: Boolean(r.error) }
    }
    if (name === 'get_design_tokens') {
      const r = await getDesignTokens(ctx)
      return { result: r, isError: Boolean(r.error) }
    }
    return { result: { error: `Unknown tool: ${name}` }, isError: true }
  } catch (e: any) {
    return { result: { error: `Tool execution failed: ${String(e?.message || e).slice(0, 160)}` }, isError: true }
  }
}

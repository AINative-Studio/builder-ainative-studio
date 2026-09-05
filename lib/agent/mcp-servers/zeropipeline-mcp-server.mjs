#!/usr/bin/env node
/**
 * ZeroPipeline MCP server (builder#555 — real Node-native implementation).
 *
 * A self-contained, real stdio MCP server for ZeroPipeline (the AINative CRM
 * primitive), calling ZeroPipeline's real REST API directly — the SAME API
 * `/api/primitive/[primitive]/[...path]/route.ts` already proxies to for
 * deployed generated apps (base confirmed there and in lib/build/zeropipeline.ts:
 * https://pipeline.ainative.studio/api/v1).
 *
 * This exists because the real published `@ainative/zeropipeline-mcp` npm
 * package (v0.1.0) ships NO Node MCP server at all — its entire content is a
 * `bin/cli.mjs` shim that shells out to a SEPARATE Python package
 * (`zeropipeline-mcp` on PyPI, FastMCP-based). This repo is Node/Next.js only
 * with no Python runtime in its Railway deploy path, so that shim would
 * silently fail at spawn time in production (see the REALITY CHECK comment
 * above MCP_SERVER_SPECS in ../agent-runtime.ts for the full investigation).
 * This module is a genuine, from-scratch reimplementation using the real
 * `@modelcontextprotocol/sdk`, not a wrapper around either the npm shim or
 * the Python package.
 *
 * Tool endpoints/params/bodies here were verified against the REAL Python
 * package's source (zeropipeline_mcp/server.py + client.py, PyPI v0.2.1,
 * downloaded and read directly via `pip download zeropipeline-mcp`) so the
 * wire contract matches the actual deployed ZeroPipeline API exactly — this
 * is a parallel real implementation of the same tool surface, not a guess.
 *
 * Auth contract (matches client.py exactly, and the flat-env-var pattern the
 * other 3 wired servers already use — NOT the founder-credential-resolution
 * flow the Next.js proxy route uses, since this runs as a standalone child
 * process with no access to that credential store):
 *   ZEROPIPELINE_API_KEY       — required. AINative bearer token/JWT (same
 *                                 identity ZeroPipeline authenticates with —
 *                                 see lib/build/zeropipeline.ts's own comment).
 *   ZEROPIPELINE_API_BASE_URL  — optional override (default
 *                                 https://pipeline.ainative.studio/api/v1).
 *   ZEROPIPELINE_AGENT_NAME    — optional, sent as X-Agent-Name header.
 *   ZEROPIPELINE_AGENT_TYPE    — optional, sent as X-Agent-Type header.
 *
 * Prioritized core CRM tool subset (13 tools — pipelines, deals, customers,
 * activities, tasks): list_pipelines, get_pipeline, list_deals, create_deal,
 * update_deal, move_deal_stage, get_deal_score, list_customers,
 * create_customer, list_activities, log_activity, list_tasks, create_task.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

const DEFAULT_BASE_URL = 'https://pipeline.ainative.studio/api/v1'

function getConfig() {
  const apiKey = process.env.ZEROPIPELINE_API_KEY || ''
  const baseUrl = (process.env.ZEROPIPELINE_API_BASE_URL || DEFAULT_BASE_URL).replace(/\/+$/, '')
  return { apiKey, baseUrl }
}

function authHeaders(apiKey) {
  const headers = {
    Authorization: `Bearer ${apiKey}`,
    'Content-Type': 'application/json',
  }
  if (process.env.ZEROPIPELINE_AGENT_NAME) headers['X-Agent-Name'] = process.env.ZEROPIPELINE_AGENT_NAME
  if (process.env.ZEROPIPELINE_AGENT_TYPE) headers['X-Agent-Type'] = process.env.ZEROPIPELINE_AGENT_TYPE
  return headers
}

function missingKeyError() {
  return {
    error: true,
    message:
      'ZEROPIPELINE_API_KEY environment variable is not set or is empty. ' +
      'Generate an API key from the ZeroPipeline dashboard (Settings > API Keys) ' +
      'and set it in your environment before using MCP tools.',
  }
}

/** Strip null/undefined values so query strings never carry "undefined". */
function cleanParams(params) {
  const out = {}
  for (const [k, v] of Object.entries(params || {})) {
    if (v !== null && v !== undefined) out[k] = v
  }
  return out
}

async function handleResponse(res) {
  let data
  const text = await res.text()
  try {
    data = text ? JSON.parse(text) : {}
  } catch {
    data = text
  }
  if (res.ok) {
    if (data && typeof data === 'object' && !Array.isArray(data)) return data
    return { items: data }
  }
  let message
  if (data && typeof data === 'object') {
    message = data.detail || data.message || data.error || JSON.stringify(data)
  } else {
    message = String(data) || `HTTP ${res.status}`
  }
  return { error: true, status: res.status, message }
}

async function apiGet(path, params) {
  const { apiKey, baseUrl } = getConfig()
  if (!apiKey) return missingKeyError()
  const url = new URL(`${baseUrl}${path}`)
  for (const [k, v] of Object.entries(cleanParams(params))) url.searchParams.set(k, v)
  try {
    const res = await fetch(url, { method: 'GET', headers: authHeaders(apiKey), signal: AbortSignal.timeout(30000) })
    return await handleResponse(res)
  } catch (e) {
    return { error: true, message: `Network error: ${e?.message || e}` }
  }
}

async function apiPost(path, body, params) {
  const { apiKey, baseUrl } = getConfig()
  if (!apiKey) return missingKeyError()
  const url = new URL(`${baseUrl}${path}`)
  for (const [k, v] of Object.entries(cleanParams(params))) url.searchParams.set(k, v)
  const timeoutMs = path.includes('/bulk') || path.includes('/import') ? 120000 : 30000
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(timeoutMs),
    })
    return await handleResponse(res)
  } catch (e) {
    return { error: true, message: `Network error: ${e?.message || e}` }
  }
}

async function apiPatch(path, body) {
  const { apiKey, baseUrl } = getConfig()
  if (!apiKey) return missingKeyError()
  const url = `${baseUrl}${path}`
  try {
    const res = await fetch(url, {
      method: 'PATCH',
      headers: authHeaders(apiKey),
      body: JSON.stringify(body || {}),
      signal: AbortSignal.timeout(30000),
    })
    return await handleResponse(res)
  } catch (e) {
    return { error: true, message: `Network error: ${e?.message || e}` }
  }
}

function fmt(data) {
  return JSON.stringify(data, null, 2)
}

function errorStr(result) {
  const status = result.status ? `Error ${result.status}: ` : 'Error: '
  return `${status}${result.message || 'Unknown error'}`
}

function textResult(str) {
  return { content: [{ type: 'text', text: str }] }
}

async function resolveOrError(resultPromise) {
  const result = await resultPromise
  if (result.error) return textResult(errorStr(result))
  return textResult(fmt(result))
}

/**
 * Tool definitions: prioritized core CRM subset (13 tools) matching
 * server.py's real endpoints/params/bodies exactly.
 */
const TOOLS = [
  {
    name: 'list_pipelines',
    description: 'List all sales pipelines in the organisation.',
    inputSchema: {
      type: 'object',
      properties: {
        limit: { type: 'number', description: 'Maximum number of pipelines to return (default 25, max 200).' },
        offset: { type: 'number', description: 'Number of items to skip for pagination (default 0).' },
      },
    },
    handler: (args) => apiGet('/pipelines', { limit: args.limit ?? 25, offset: args.offset ?? 0 }),
  },
  {
    name: 'get_pipeline',
    description: 'Fetch a single pipeline by UUID, including all nested stages.',
    inputSchema: {
      type: 'object',
      properties: { pipeline_id: { type: 'string', description: 'UUID of the pipeline to retrieve.' } },
      required: ['pipeline_id'],
    },
    handler: (args) => apiGet(`/pipelines/${encodeURIComponent(args.pipeline_id)}`),
  },
  {
    name: 'list_deals',
    description: 'List deals with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        pipeline_id: { type: 'string', description: 'Optional UUID — filter deals in a specific pipeline.' },
        stage_id: { type: 'string', description: 'Optional UUID — filter deals in a specific stage.' },
        status: { type: 'string', description: "Optional status string (e.g. 'open', 'won', 'lost')." },
        customer_id: { type: 'string', description: 'Optional UUID — filter deals linked to a specific customer.' },
        query: { type: 'string', description: 'Optional search string (minimum 3 characters).' },
        limit: { type: 'number', description: 'Maximum number of deals to return (default 25).' },
        offset: { type: 'number', description: 'Number of items to skip for pagination (default 0).' },
      },
    },
    handler: (args) =>
      apiGet('/deals', {
        pipeline_id: args.pipeline_id,
        stage_id: args.stage_id,
        status: args.status,
        customer_id: args.customer_id,
        q: args.query,
        limit: args.limit ?? 25,
        offset: args.offset ?? 0,
      }),
  },
  {
    name: 'create_deal',
    description: 'Create a new deal in a pipeline stage.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Display name for the deal.' },
        pipeline_id: { type: 'string', description: 'UUID of the pipeline this deal belongs to.' },
        stage_id: { type: 'string', description: 'UUID of the stage to place the deal in initially.' },
        value: { type: 'number', description: 'Optional monetary value of the deal.' },
        customer_id: { type: 'string', description: 'Optional UUID of the linked customer record.' },
        currency: { type: 'string', description: "ISO 4217 currency code (default 'USD')." },
      },
      required: ['name', 'pipeline_id', 'stage_id'],
    },
    handler: (args) =>
      apiPost('/deals', {
        name: args.name,
        pipeline_id: args.pipeline_id,
        stage_id: args.stage_id,
        currency: args.currency ?? 'USD',
        ...(args.value !== undefined ? { value: args.value } : {}),
        ...(args.customer_id !== undefined ? { customer_id: args.customer_id } : {}),
      }),
  },
  {
    name: 'update_deal',
    description: 'Update one or more fields on an existing deal.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal to update.' },
        name: { type: 'string', description: 'New display name.' },
        value: { type: 'number', description: 'New monetary value.' },
        stage_id: { type: 'string', description: 'Move the deal to this stage UUID.' },
        status: { type: 'string', description: "New status (e.g. 'open', 'won', 'lost')." },
        customer_id: { type: 'string', description: 'Link or re-link to a customer UUID.' },
        currency: { type: 'string', description: 'ISO 4217 currency code.' },
      },
      required: ['deal_id'],
    },
    handler: (args) => {
      const body = {}
      for (const k of ['name', 'value', 'stage_id', 'status', 'customer_id', 'currency']) {
        if (args[k] !== undefined) body[k] = args[k]
      }
      if (Object.keys(body).length === 0) {
        return Promise.resolve({ error: true, message: 'at least one field must be provided to update.' })
      }
      return apiPatch(`/deals/${encodeURIComponent(args.deal_id)}`, body)
    },
  },
  {
    name: 'move_deal_stage',
    description: 'Move a deal to a different pipeline stage.',
    inputSchema: {
      type: 'object',
      properties: {
        deal_id: { type: 'string', description: 'UUID of the deal to move.' },
        stage_id: { type: 'string', description: 'UUID of the target stage.' },
      },
      required: ['deal_id', 'stage_id'],
    },
    handler: (args) => apiPatch(`/deals/${encodeURIComponent(args.deal_id)}`, { stage_id: args.stage_id }),
  },
  {
    name: 'get_deal_score',
    description: 'Get the auto-calculated health score (0-100) for a deal.',
    inputSchema: {
      type: 'object',
      properties: { deal_id: { type: 'string', description: 'UUID of the deal to score.' } },
      required: ['deal_id'],
    },
    handler: (args) => apiGet(`/deals/${encodeURIComponent(args.deal_id)}/score`),
  },
  {
    name: 'list_customers',
    description: 'List customers with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter (e.g. 'active', 'inactive')." },
        source: { type: 'string', description: "Optional source filter (e.g. 'investor-list', 'vc_import')." },
        tags: { type: 'string', description: "Optional comma-separated tags filter (e.g. 'investor' or 'investor,vc')." },
        limit: { type: 'number', description: 'Number of records per page (default 25, max 100).' },
        page: { type: 'number', description: 'Page number (1-indexed, default 1).' },
      },
    },
    handler: (args) =>
      apiGet('/customers', {
        page: args.page ?? 1,
        page_size: args.limit ?? 25,
        status: args.status,
        source: args.source,
        tags: args.tags,
      }),
  },
  {
    name: 'create_customer',
    description: 'Create a new customer record.',
    inputSchema: {
      type: 'object',
      properties: {
        name: { type: 'string', description: 'Full name of the customer or contact.' },
        email: { type: 'string', description: 'Primary email address.' },
        phone: { type: 'string', description: 'Primary phone number.' },
        company: { type: 'string', description: 'Company or organisation.' },
        title: { type: 'string', description: 'Job title or role.' },
        source: { type: 'string', description: "Lead source (e.g. 'sc-local-discovery', 'linkedin-import')." },
        status: { type: 'string', description: "Customer status ('active', 'inactive', 'lead', 'prospect', 'churned')." },
        tags: { type: 'array', items: { type: 'string' }, description: 'List of tag strings for filtering and segmentation.' },
        meta: { type: 'object', description: 'Arbitrary metadata (address, website, etc.).' },
      },
      required: ['name'],
    },
    handler: (args) => {
      const body = { name: args.name }
      for (const k of ['email', 'phone', 'company', 'title', 'source', 'status', 'tags', 'meta']) {
        if (args[k] !== undefined) body[k] = args[k]
      }
      return apiPost('/customers', body)
    },
  },
  {
    name: 'list_activities',
    description: 'List activity log entries with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        related_to_id: { type: 'string', description: 'Optional UUID — filter for a specific entity.' },
        related_to_type: { type: 'string', description: "Optional entity type ('deal', 'customer', 'pipeline')." },
        activity_type: { type: 'string', description: 'Optional activity type to filter by.' },
        actor_id: { type: 'string', description: 'Optional UUID — filter by performer.' },
        customer_id: {
          type: 'string',
          description:
            'Optional UUID — convenience filter for activities logged against a specific customer. ' +
            "Equivalent to related_to_id=<customer_id> with related_to_type='customer'. " +
            'Ignored if related_to_id is also provided.',
        },
        limit: { type: 'number', description: 'Maximum number of activities to return (default 50).' },
        offset: { type: 'number', description: 'Number of items to skip for pagination (default 0).' },
      },
    },
    handler: (args) => {
      const params = { limit: args.limit ?? 50, offset: args.offset ?? 0 }
      if (args.related_to_id !== undefined) {
        params.related_to_id = args.related_to_id
      } else if (args.customer_id !== undefined) {
        params.related_to_id = args.customer_id
        params.related_to_type = args.related_to_type ?? 'customer'
      }
      if (args.related_to_type !== undefined) params.related_to_type = args.related_to_type
      if (args.activity_type !== undefined) params.activity_type = args.activity_type
      if (args.actor_id !== undefined) params.actor_id = args.actor_id
      return apiGet('/activities', params)
    },
  },
  {
    name: 'log_activity',
    description: 'Log a new activity against a CRM entity.',
    inputSchema: {
      type: 'object',
      properties: {
        activity_type: { type: 'string', description: "Type of activity (e.g. 'call', 'email', 'note', 'meeting')." },
        related_to_type: { type: 'string', description: "Entity type ('deal', 'customer', 'pipeline')." },
        related_to_id: { type: 'string', description: 'UUID of the entity.' },
        description: { type: 'string', description: 'Optional description of what happened.' },
        actor_id: { type: 'string', description: 'Optional UUID of the performer.' },
      },
      required: ['activity_type', 'related_to_type', 'related_to_id'],
    },
    handler: (args) => {
      const body = {
        activity_type: args.activity_type,
        related_to_type: args.related_to_type,
        related_to_id: args.related_to_id,
      }
      if (args.description !== undefined) body.description = args.description
      if (args.actor_id !== undefined) body.actor_id = args.actor_id
      return apiPost('/activities', body)
    },
  },
  {
    name: 'list_tasks',
    description: 'List tasks with optional filters.',
    inputSchema: {
      type: 'object',
      properties: {
        status: { type: 'string', description: "Optional status filter ('open', 'in_progress', 'done')." },
        assignee_id: { type: 'string', description: 'Optional UUID to filter by assignee.' },
        limit: { type: 'number', description: 'Maximum number of tasks to return (default 25).' },
      },
    },
    handler: (args) => apiGet('/tasks', { limit: args.limit ?? 25, status: args.status, assignee_id: args.assignee_id }),
  },
  {
    name: 'create_task',
    description: 'Create a new CRM task.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Short summary of what needs to be done.' },
        description: { type: 'string', description: 'Optional detailed description.' },
        assignee_id: { type: 'string', description: 'Optional UUID of the assignee.' },
        due_date: { type: 'string', description: 'Optional due date in ISO 8601 format.' },
        related_to_type: { type: 'string', description: 'Optional entity type to link to.' },
        related_to_id: { type: 'string', description: 'Optional UUID of the linked entity.' },
      },
      required: ['title'],
    },
    handler: (args) => {
      const body = { title: args.title }
      for (const k of ['description', 'assignee_id', 'due_date', 'related_to_type', 'related_to_id']) {
        if (args[k] !== undefined) body[k] = args[k]
      }
      return apiPost('/tasks', body)
    },
  },
]

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export function buildServer() {
  const server = new Server(
    { name: 'zeropipeline', version: '1.0.0' },
    { capabilities: { tools: {} } },
  )

  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })),
  }))

  server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const tool = TOOLS_BY_NAME.get(request.params.name)
    if (!tool) {
      return textResult(`Error: unknown tool '${request.params.name}'`)
    }
    return resolveOrError(tool.handler(request.params.arguments || {}))
  })

  return server
}

async function main() {
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// Only auto-run when executed directly (not when imported for tests).
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`zeropipeline-mcp-server fatal: ${err?.stack || err}\n`)
    process.exit(1)
  })
}

export { TOOLS, apiGet, apiPost, apiPatch, getConfig }

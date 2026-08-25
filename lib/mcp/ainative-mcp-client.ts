/**
 * AINative multi-server MCP client (#73).
 *
 * A minimal, dependency-free client that can connect to any AINative MCP server
 * over the MCP Streamable-HTTP transport (JSON-RPC 2.0), list its tools, and call
 * them — exposing them for Cody's agent loop (tool_use). It generalizes the
 * fetch-based pattern already used by `zerodb-client.ts` / `design-system-client.ts`
 * (retry with exponential backoff, health/connect gating, graceful degradation)
 * rather than duplicating a per-server client for each of the 7+ published servers.
 *
 * Why raw JSON-RPC over fetch instead of `@modelcontextprotocol/sdk`:
 *  - The SDK is NOT a dependency of this Next.js app; adding it (and its stdio
 *    transports) is out of scope for the phase-1 HTTP wedge.
 *  - Every AINative published MCP server (docs/AINATIVE_PRIMITIVES.md §6) speaks
 *    Streamable HTTP, which is plain POST + JSON-RPC — trivially reachable with the
 *    same `fetch` we already use, and trivially mockable in tests (no real budget).
 *  - Matches the house style of the existing `lib/mcp/*` clients.
 *
 * SECURITY: MCP credentials come from env only (never hardcoded). When no key is
 * configured the client stays inert (connect() returns false) so nothing breaks.
 *
 * Test coverage requirement: ≥80% (transport mocked — no real MCP budget spent).
 */

import { logger } from '../logger'
import { getMcpServer, type McpServerRef } from '../build/primitive-catalog'

/** A tool advertised by an MCP server (subset of the MCP `tools/list` shape). */
export interface McpTool {
  name: string
  description?: string
  /** JSON Schema for the tool's arguments (MCP `inputSchema`). */
  inputSchema?: Record<string, unknown>
}

/** Result of an MCP `tools/call` (subset of the MCP result shape). */
export interface McpToolResult {
  /** MCP content blocks (text/json/etc). */
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>
  /** True when the tool itself reported an error (protocol-level, not transport). */
  isError?: boolean
  /** Structured result, when the server returns one. */
  structuredContent?: unknown
  [k: string]: unknown
}

export interface AiNativeMcpClientOptions {
  /** Server descriptor (from MCP_SERVERS) OR an explicit endpoint. */
  server?: McpServerRef
  /** Explicit endpoint override (wins over `server.url`). */
  url?: string
  /** Bearer token; defaults to env (AINATIVE_MCP_API_KEY → AINATIVE_API_KEY → ZERODB_API_KEY). */
  apiKey?: string
  /** Retry attempts for transport failures (default 3). */
  maxRetries?: number
  /** Base backoff delay in ms (default 1000 → 1s/2s/4s). */
  baseDelay?: number
  /** Injected fetch (tests). Defaults to global fetch. */
  fetchImpl?: typeof fetch
}

interface JsonRpcResponse<T = unknown> {
  jsonrpc: '2.0'
  id: number | string | null
  result?: T
  error?: { code: number; message: string; data?: unknown }
}

const DEFAULT_KEY = () =>
  (typeof process !== 'undefined' &&
    (process.env?.AINATIVE_MCP_API_KEY ||
      process.env?.AINATIVE_API_KEY ||
      process.env?.ZERODB_API_KEY)) ||
  ''

/**
 * A connection to a single AINative MCP server. Construct one per server; use
 * {@link connectMcpServer} to build one from a server id.
 */
export class AiNativeMcpClient {
  readonly url: string
  readonly label: string
  private apiKey: string
  private maxRetries: number
  private baseDelay: number
  private fetchImpl: typeof fetch
  private connected = false
  private sessionId: string | null = null
  private nextId = 1

  constructor(opts: AiNativeMcpClientOptions = {}) {
    this.url = opts.url || opts.server?.url || ''
    this.label = opts.server?.label || this.url || 'AINative MCP'
    this.apiKey = opts.apiKey ?? DEFAULT_KEY()
    this.maxRetries = opts.maxRetries ?? 3
    this.baseDelay = opts.baseDelay ?? 1000
    this.fetchImpl = opts.fetchImpl ?? (globalThis.fetch as typeof fetch)

    if (!this.url) {
      logger.warn('AiNativeMcpClient constructed without a URL — will stay inert')
    }
    if (!this.apiKey) {
      logger.warn(`No MCP API key configured for ${this.label} — client will stay inert`)
    }
  }

  /** True once {@link connect} has succeeded. */
  isConnected(): boolean {
    return this.connected
  }

  /** Whether this client has the minimum config to operate (URL + key). */
  isConfigured(): boolean {
    return !!this.url && !!this.apiKey && typeof this.fetchImpl === 'function'
  }

  /**
   * Perform the MCP `initialize` handshake. Returns false (never throws) when the
   * client is unconfigured or the server is unreachable, so callers can degrade
   * gracefully and never break the build/runtime.
   */
  async connect(): Promise<boolean> {
    if (!this.isConfigured()) {
      logger.warn(`Skipping MCP connect for ${this.label}: not configured`)
      this.connected = false
      return false
    }
    try {
      const res = await this.rpc('initialize', {
        protocolVersion: '2025-06-18',
        capabilities: {},
        clientInfo: { name: 'ainative-builder', version: '1.0.0' },
      })
      if (res.error) throw new Error(`initialize failed: ${res.error.message}`)
      this.connected = true
      // Best-effort notify the server we're ready (MCP `notifications/initialized`).
      await this.notify('notifications/initialized').catch(() => {})
      logger.info(`Connected to MCP server ${this.label}`)
      return true
    } catch (error) {
      logger.error(`Failed to connect to MCP server ${this.label}`, error as Error)
      this.connected = false
      return false
    }
  }

  /**
   * List the tools the server exposes (MCP `tools/list`). Returns [] on failure so
   * the agent loop can proceed without them.
   */
  async listTools(): Promise<McpTool[]> {
    if (!this.ensureReady()) return []
    try {
      const res = await this.rpc<{ tools?: McpTool[] }>('tools/list', {})
      if (res.error) throw new Error(res.error.message)
      const tools = res.result?.tools ?? []
      logger.info(`Listed ${tools.length} tools from ${this.label}`)
      return tools
    } catch (error) {
      logger.error(`Failed to list tools from ${this.label}`, error as Error)
      return []
    }
  }

  /**
   * Call a tool by name (MCP `tools/call`). Never throws — a transport failure
   * returns `{ isError: true, ... }` so the agent loop can record and continue.
   */
  async callTool(name: string, args: Record<string, unknown> = {}): Promise<McpToolResult> {
    if (!this.ensureReady()) {
      return { isError: true, content: [{ type: 'text', text: 'MCP client not connected' }] }
    }
    try {
      const res = await this.rpc<McpToolResult>('tools/call', { name, arguments: args })
      if (res.error) {
        logger.error(`MCP tool ${name} on ${this.label} errored: ${res.error.message}`)
        return { isError: true, content: [{ type: 'text', text: res.error.message }] }
      }
      logger.info(`Called MCP tool ${name} on ${this.label}`)
      return res.result ?? {}
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      logger.error(`Failed to call MCP tool ${name} on ${this.label}`, error as Error)
      return { isError: true, content: [{ type: 'text', text: message }] }
    }
  }

  /** Mark the client disconnected (stateless HTTP — no socket to close). */
  async disconnect(): Promise<void> {
    this.connected = false
    this.sessionId = null
    logger.info(`Disconnected from MCP server ${this.label}`)
  }

  // ---- internals ----

  private ensureReady(): boolean {
    if (!this.connected) {
      logger.warn(`MCP client ${this.label} not connected`)
      return false
    }
    return true
  }

  private headers(): Record<string, string> {
    const h: Record<string, string> = {
      'Content-Type': 'application/json',
      // MCP Streamable HTTP requires the client to accept both JSON and SSE.
      Accept: 'application/json, text/event-stream',
      Authorization: `Bearer ${this.apiKey}`,
      'X-Client-Version': '1.0.0',
    }
    if (this.sessionId) h['Mcp-Session-Id'] = this.sessionId
    return h
  }

  /** Send a JSON-RPC request and parse the response (JSON or single-event SSE). */
  private async rpc<T = unknown>(
    method: string,
    params: Record<string, unknown>,
  ): Promise<JsonRpcResponse<T>> {
    const id = this.nextId++
    const body = JSON.stringify({ jsonrpc: '2.0', id, method, params })
    return this.retry(async () => {
      const res = await this.fetchImpl(this.url, { method: 'POST', headers: this.headers(), body })
      // Capture a server-assigned session id (MCP Streamable HTTP).
      const sid = res.headers?.get?.('mcp-session-id')
      if (sid) this.sessionId = sid
      if (!res.ok) {
        throw new Error(`MCP HTTP ${res.status} ${res.statusText || ''} from ${this.label}`)
      }
      return this.parseBody<T>(res)
    })
  }

  /** Fire-and-forget JSON-RPC notification (no id, no response expected). */
  private async notify(method: string, params: Record<string, unknown> = {}): Promise<void> {
    const body = JSON.stringify({ jsonrpc: '2.0', method, params })
    await this.fetchImpl(this.url, { method: 'POST', headers: this.headers(), body })
  }

  /**
   * Parse a Streamable-HTTP response body. Servers may reply with a single JSON
   * object (Content-Type application/json) or an SSE stream (text/event-stream)
   * carrying one `data:` JSON-RPC frame. Handle both.
   */
  private async parseBody<T>(res: Response): Promise<JsonRpcResponse<T>> {
    const contentType = res.headers?.get?.('content-type') || ''
    const text = await res.text()
    if (contentType.includes('text/event-stream') || (!contentType.includes('json') && text.includes('data:'))) {
      // Extract the last `data:` line's JSON payload.
      const line = text
        .split('\n')
        .map((l) => l.trim())
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice('data:'.length).trim())
        .filter(Boolean)
        .pop()
      if (!line) throw new Error(`Empty SSE response from ${this.label}`)
      return JSON.parse(line) as JsonRpcResponse<T>
    }
    if (!text) throw new Error(`Empty response from ${this.label}`)
    return JSON.parse(text) as JsonRpcResponse<T>
  }

  /** Retry a transport op with exponential backoff (1s → 2s → 4s), matching zerodb-client. */
  private async retry<T>(fn: () => Promise<T>, attempt = 1): Promise<T> {
    try {
      return await fn()
    } catch (error) {
      if (attempt >= this.maxRetries) {
        logger.error(`MCP request to ${this.label} failed after ${this.maxRetries} attempts`, error as Error)
        throw error
      }
      const delay = this.baseDelay * Math.pow(2, attempt - 1)
      logger.warn(`MCP request to ${this.label} attempt ${attempt} failed, retrying in ${delay}ms`)
      await new Promise((r) => setTimeout(r, delay))
      return this.retry(fn, attempt + 1)
    }
  }
}

/**
 * Build + connect an MCP client for a published server id (from MCP_SERVERS).
 * Returns null (never throws) when the id is unknown, the transport isn't HTTP,
 * or the connection fails — so callers degrade gracefully.
 */
export async function connectMcpServer(
  id: string,
  opts: Omit<AiNativeMcpClientOptions, 'server'> = {},
): Promise<AiNativeMcpClient | null> {
  const server = getMcpServer(id)
  if (!server) {
    logger.warn(`Unknown MCP server id: ${id}`)
    return null
  }
  if (server.transport !== 'http') {
    logger.warn(`MCP server ${id} uses ${server.transport} transport — HTTP client cannot connect`)
    return null
  }
  const client = new AiNativeMcpClient({ server, ...opts })
  const ok = await client.connect()
  return ok ? client : null
}

/**
 * A thin registry so the agent loop can hold several server connections at once
 * and route a tool_use to the right one. Phase-1 keeps it minimal (map of id →
 * client); the agent-loop wiring (#22) can layer tool namespacing on top.
 */
export class McpFleet {
  private clients = new Map<string, AiNativeMcpClient>()

  /** Connect (or reuse) a server by id; returns the client or null. */
  async use(id: string, opts?: Omit<AiNativeMcpClientOptions, 'server'>): Promise<AiNativeMcpClient | null> {
    const existing = this.clients.get(id)
    if (existing?.isConnected()) return existing
    const client = await connectMcpServer(id, opts)
    if (client) this.clients.set(id, client)
    return client
  }

  /** All connected clients. */
  connected(): AiNativeMcpClient[] {
    return Array.from(this.clients.values()).filter((c) => c.isConnected())
  }

  /** Disconnect everything. */
  async closeAll(): Promise<void> {
    await Promise.all(Array.from(this.clients.values()).map((c) => c.disconnect()))
    this.clients.clear()
  }
}

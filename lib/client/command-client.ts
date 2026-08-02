/**
 * Command Client (browser-safe)
 *
 * Thin fetch wrapper around the /api/commands REST endpoints for use in
 * client components. The command palette must NOT import the server-side
 * `agent-command.service`, because that pulls Drizzle + the postgres driver
 * into the browser bundle (breaking `next build` and runtime). All data
 * access from the UI goes through this module instead.
 *
 * Issue #17 — Command Palette for Agent Workflows.
 */

import type {
  AgentCommand,
  CommandSearchQuery,
  CommandSearchResult,
  CommandExecutionState,
} from '@/lib/types/agent-commands'

/**
 * Build a query string from a CommandSearchQuery, omitting empty values.
 */
export function buildSearchParams(query: CommandSearchQuery): string {
  const params = new URLSearchParams()

  if (query.query) params.set('query', query.query)
  if (query.category) params.set('category', String(query.category))
  if (query.tags && query.tags.length > 0) params.set('tags', query.tags.join(','))
  if (query.authorId) params.set('authorId', query.authorId)
  if (query.builtInOnly) params.set('builtInOnly', 'true')
  if (query.teamOnly) params.set('teamOnly', 'true')
  if (query.favoritesOnly) params.set('favoritesOnly', 'true')
  if (query.sortBy) params.set('sortBy', String(query.sortBy))
  if (typeof query.limit === 'number') params.set('limit', String(query.limit))
  if (typeof query.offset === 'number') params.set('offset', String(query.offset))

  return params.toString()
}

async function parseJson<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let message = `Request failed with status ${res.status}`
    try {
      const body = await res.json()
      if (body?.error) message = body.error
    } catch {
      // ignore non-JSON error bodies
    }
    throw new Error(message)
  }
  return (await res.json()) as T
}

/**
 * Search / list commands via GET /api/commands.
 */
export async function searchCommands(
  query: CommandSearchQuery
): Promise<CommandSearchResult> {
  const qs = buildSearchParams(query)
  const res = await fetch(`/api/commands${qs ? `?${qs}` : ''}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  return parseJson<CommandSearchResult>(res)
}

/**
 * Fetch recently executed commands via GET /api/commands/recent.
 */
export async function getRecentCommands(limit = 10): Promise<AgentCommand[]> {
  const res = await fetch(`/api/commands/recent?limit=${limit}`, {
    method: 'GET',
    headers: { Accept: 'application/json' },
  })
  const data = await parseJson<{ commands: AgentCommand[] }>(res)
  return data.commands ?? []
}

/**
 * Toggle favorite status via POST /api/commands/[id]/favorite.
 * Returns the new favorite state.
 */
export async function toggleFavorite(commandId: string): Promise<boolean> {
  const res = await fetch(`/api/commands/${commandId}/favorite`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  })
  const data = await parseJson<{ isFavorite: boolean }>(res)
  return data.isFavorite
}

/**
 * Execute a command via POST /api/commands/[id]/execute.
 */
export async function executeCommand(
  commandId: string,
  variableValues: Record<string, unknown>,
  options?: { chatId?: string; gitContext?: unknown }
): Promise<CommandExecutionState> {
  const res = await fetch(`/api/commands/${commandId}/execute`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      variableValues,
      chatId: options?.chatId,
      gitContext: options?.gitContext,
    }),
  })
  return parseJson<CommandExecutionState>(res)
}

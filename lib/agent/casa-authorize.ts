/**
 * Feed real tool-call decisions from this app's Cody agent loop into core's
 * CASA dataset pipeline (Refs core#5019).
 *
 * core's CASA authorizer (authorize_tool_call_inline) is an in-process
 * Python function — unreachable from this TypeScript app directly. core#5019
 * adds POST /api/v1/internal/casa/authorize as a thin cross-service wrapper
 * over it, auth'd via the existing X-Internal-API-Key pattern (same one
 * app/api/internal/cache.py already uses, core#3092).
 *
 * Fire-and-forget by design, mirroring trajectory-store.ts: this must NEVER
 * block or fail the real build/generation path. A dropped or failed call
 * here just means one fewer labeled row in casa_labeled — never a broken
 * build for the user.
 */
import { AINATIVE_API_BASE_URL } from '@/lib/constants'

function internalApiKey(): string | undefined {
  return process.env.AINATIVE_INTERNAL_API_KEY
}

export interface CasaAuthorizeCall {
  toolName: string
  task?: string
  toolParams?: Record<string, unknown>
  agentId?: string
  conversationId?: string
}

/** Fire-and-forget. Never throws, never awaited by callers that don't want to. */
export function authorizeToolCall(call: CasaAuthorizeCall): void {
  const key = internalApiKey()
  if (!key) {
    // Not configured in this environment (e.g. local dev) — stay inert,
    // same posture as trajectory-store.ts's missing-token skip.
    return
  }

  fetch(`${AINATIVE_API_BASE_URL}/api/v1/internal/casa/authorize`, {
    method: 'POST',
    headers: {
      'X-Internal-API-Key': key,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      tool_name: call.toolName,
      task: call.task,
      tool_params: call.toolParams,
      agent_id: call.agentId,
      conversation_id: call.conversationId,
      source_service: 'builder-ainative-studio',
    }),
  })
    .then((res) => {
      if (!res.ok) {
        console.warn(`[CASA] authorize call failed: HTTP ${res.status}`)
      }
    })
    .catch((err) => {
      console.warn('[CASA] authorize call error:', err instanceof Error ? err.message : err)
    })
}

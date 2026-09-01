import { NextRequest, NextResponse } from 'next/server'

/**
 * Shared handler for the hosted-MCP-gateway subdomain paths (Refs core#6667).
 *
 * `mcp.ainative.studio`, `strapi.mcp.ainative.studio`-style paths, and a few
 * others are documented (docs/mcp/full-server) as reaching a hosted MCP
 * Streamable-HTTP gateway at `https://mcp.ainative.studio/{server}`. In
 * production that domain's traffic lands on builder-ainative-studio (via its
 * `*.ainative.studio` wildcard custom domain) at `/build/{server}/...`, where
 * there was previously no route at all — Next's router fell through to a
 * generic client-rendered 404 SPA page. Any MCP client following the docs
 * got HTML back instead of a JSON-RPC response, with no useful signal about
 * why.
 *
 * This does NOT implement the hosted MCP gateway itself (that's tracked
 * separately, core#6667's larger follow-up) — it makes the failure honest:
 * a real MCP client sending a JSON-RPC POST gets a JSON-RPC-shaped error
 * response with a clear reason, instead of HTML wrapped in a 404.
 */
export function hostedMcpNotImplemented(serverName: string) {
  return async function handler(req: NextRequest): Promise<NextResponse> {
    const body: Record<string, unknown> = {
      jsonrpc: '2.0',
      error: {
        code: -32601, // JSON-RPC "Method not found" — closest standard code for
        // "this endpoint doesn't implement the protocol you're using"
        message: `The hosted MCP gateway for '${serverName}' is not yet implemented`,
        data: {
          server: serverName,
          detail:
            'mcp.ainative.studio documents a hosted Streamable-HTTP MCP gateway, ' +
            'but no backend currently serves the MCP protocol at this path. ' +
            'Refs AINative-Studio/core#6667.',
        },
      },
      id: null,
    }

    // Best-effort: echo back the request's JSON-RPC id if it sent one, so a
    // real MCP client can correlate the error with its request.
    try {
      const parsed = await req.json()
      if (parsed && typeof parsed === 'object' && 'id' in parsed) {
        body.id = (parsed as { id: unknown }).id
      }
    } catch {
      // Not JSON, or no body (e.g. a GET) — id stays null.
    }

    return NextResponse.json(body, { status: 501 })
  }
}

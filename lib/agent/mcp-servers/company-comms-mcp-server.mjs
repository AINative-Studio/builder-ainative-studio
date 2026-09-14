#!/usr/bin/env node
/**
 * Company-comms MCP server (#733, child of #414) — gives Cody's own agent
 * loop (and the nightly loop, running against a live, already-provisioned
 * company) the real ability to reach out to that company's founder or its
 * customers: to share a project status update, ask for feedback on the
 * build, or otherwise follow up on their behalf. This is deliberately framed
 * as founder/customer OUTREACH, not a bare send_sms/send_email/send_call
 * primitive with no context — the underlying capability is genuinely "text,
 * call, or email someone about their project," and the tool descriptions
 * below say so, so Cody's own tool-selection reasons about it the same way.
 *
 * This calls this SAME deployed Next.js app's own real routes
 * (/api/build/company-comms for SMS/voice, /api/build/company-email for
 * email) rather than re-implementing their founder-credential resolution /
 * provisioning checks here — those routes already fail closed correctly (no
 * ZeroVoice number, no captured founder credential, no Resend key, etc. all
 * surface an honest reason), and duplicating that logic in a second place
 * would be a real correctness risk (the two copies could drift). This
 * standalone MCP server process is a bare Node ESM child process with no
 * Next.js module resolution, so it reaches both capabilities the same
 * honest way: a plain HTTP call to this app's own public base URL
 * (NEXT_PUBLIC_APP_URL), never a cross-runtime import of TypeScript source.
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js'

function getBaseUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio').replace(/\/+$/, '')
}

function textResult(str) {
  return { content: [{ type: 'text', text: str }] }
}

function fmt(data) {
  return JSON.stringify(data, null, 2)
}

async function callCompanyComms(payload) {
  try {
    const res = await fetch(`${getBaseUrl()}/api/build/company-comms`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(30000),
    })
    const data = await res.json().catch(() => ({ ok: false, reason: 'invalid_response' }))
    return data
  } catch (e) {
    return { ok: false, reason: `Network error: ${e?.message || e}` }
  }
}

async function callCompanyEmail(companyName, to, subject, html, text) {
  try {
    const res = await fetch(`${getBaseUrl()}/api/build/company-email`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ companyName, to, subject, html, text }),
      signal: AbortSignal.timeout(30000),
    })
    return await res.json().catch(() => ({ ok: false, reason: 'invalid_response' }))
  } catch (e) {
    return { ok: false, reason: `Network error: ${e?.message || e}` }
  }
}

const TOOLS = [
  {
    name: 'contact_founder_for_feedback',
    description:
      "Text or call a company's founder about their build/project — for example to share a status "
      + 'update on progress, flag something that needs their input, or ask for feedback on a recent '
      + 'change. Routes through the company\'s own real, provisioned ZeroVoice number; fails honestly '
      + '(no fabricated success) if the company has no phone number provisioned or no captured founder '
      + 'credential yet.',
    inputSchema: {
      type: 'object',
      properties: {
        slug: { type: 'string', description: 'The company/app slug to act on behalf of.' },
        to: { type: 'string', description: "The founder's phone number in E.164 format (e.g. +15551234567)." },
        channel: { type: 'string', enum: ['sms', 'call'], description: "'sms' to text, 'call' to place a voice call." },
        message: { type: 'string', description: 'The text message body. Required when channel is sms.' },
        record: { type: 'boolean', description: 'Optional — record the call. Only used when channel is call.' },
      },
      required: ['slug', 'to', 'channel'],
    },
    handler: (args) =>
      callCompanyComms({
        slug: args.slug,
        action: args.channel,
        to: args.to,
        ...(args.channel === 'sms' ? { body: args.message } : {}),
        ...(args.channel === 'call' && args.record ? { record: true } : {}),
      }),
  },
  {
    name: 'send_project_update_email',
    description:
      "Email a company's founder or one of their customers about the project — a status update, "
      + "a request for feedback on the build, or a follow-up on their behalf. Sent from the company's "
      + "own name (\"{companyName} via AINative\") through AINative's real Resend integration. Fails "
      + 'honestly (no fabricated success) if email sending is not configured or the send itself fails.',
    inputSchema: {
      type: 'object',
      properties: {
        companyName: { type: 'string', description: 'The company name to send from (shown as the from-name).' },
        to: { type: 'string', description: 'Recipient email address.' },
        subject: { type: 'string', description: 'Email subject line.' },
        html: { type: 'string', description: 'HTML body of the email.' },
        text: { type: 'string', description: 'Plain-text body of the email (fallback for clients that block HTML).' },
      },
      required: ['companyName', 'to', 'subject'],
    },
    handler: (args) => callCompanyEmail(args.companyName, args.to, args.subject, args.html || '', args.text || args.html || ''),
  },
]

const TOOLS_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]))

export function buildServer() {
  const server = new Server(
    { name: 'company-comms', version: '1.0.0' },
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
    const result = await tool.handler(request.params.arguments || {})
    return textResult(fmt(result))
  })

  return server
}

async function main() {
  const server = buildServer()
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((err) => {
    process.stderr.write(`company-comms-mcp-server fatal: ${err?.stack || err}\n`)
    process.exit(1)
  })
}

export { TOOLS, callCompanyComms, callCompanyEmail }

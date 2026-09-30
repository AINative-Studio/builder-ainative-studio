/**
 * GET /openapi.json (AX/agent-readiness scan, 2026-09-30) — a real OpenAPI 3.1
 * spec covering Builder's genuinely agent-callable surface: the routes already
 * documented as agent-facing in public/llms.txt (chat-ws, artifact, ask,
 * systems, preview, enroll, health) plus the routes marked "AX: agent-
 * accessible" in their own doc comments (secrets, redeploy, deck).
 *
 * Deliberately does NOT enumerate all ~50 app/api/* route groups — most back
 * Builder's own frontend and were never designed as a public API surface.
 * Documenting them here would be dishonest (implying a stable public contract
 * that doesn't exist) rather than fixing a real gap. This spec only covers
 * routes this codebase's own comments already call out as intended for
 * external/agent use.
 *
 * Auth: most of these accept an anonymous/guest caller (matching Builder's own
 * "no signup wall for the core build loop" product stance) OR use the same
 * NextAuth session cookie a signed-in founder's browser already carries — there
 * is no separate API-key scheme. The owner-scoped routes (secrets, redeploy,
 * deck) require that real session; see the OAuth discovery document at
 * /.well-known/oauth-authorization-server for how an external agent obtains
 * one on the founder's behalf (core's real OAuth2.1/PKCE flow).
 */

const SITE = 'https://builder.ainative.studio'

const spec = {
  openapi: '3.1.0',
  info: {
    title: 'AINative Builder API',
    version: '1.0.0',
    description:
      'The agent-callable surface of AINative Builder: generate an app or company from an idea, ' +
      "ask Cody about a company's plan, read a company's live business-systems state, and manage " +
      "a founder's own deployed app (secrets, redeploy, pitch deck export). See " +
      `${SITE}/llms.txt for a plain-language index of these same endpoints.`,
    contact: { url: 'https://ainative.studio' },
  },
  servers: [{ url: SITE }],
  security: [{ sessionCookie: [] }, {}],
  paths: {
    '/api/health': {
      get: {
        operationId: 'getHealth',
        summary: 'Platform health check',
        description: 'Real, unauthenticated liveness/readiness signal — database connectivity, recent error counts, and the deployed build version.',
        security: [],
        responses: {
          '200': {
            description: 'Healthy',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    status: { type: 'string', enum: ['healthy', 'degraded', 'unhealthy'] },
                    timestamp: { type: 'string', format: 'date-time' },
                    version: { type: 'string', description: 'Deployed commit SHA' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/chat-ws': {
      post: {
        operationId: 'generateApp',
        summary: 'Generate a real, running app or company from an idea',
        description: "The core build loop. Streams progress via Server-Sent Events and persists the generated app under a chatId that resolves at GET /api/preview/{chatId}.",
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['message'],
                properties: {
                  message: { type: 'string', description: "The founder's idea, in plain language." },
                  chatId: { type: 'string', description: 'Continue an existing generation/conversation. Omit to start a new one.' },
                  model: { type: 'string', description: 'Optional model override.' },
                },
              },
            },
          },
        },
        responses: {
          '200': { description: 'text/event-stream of generation progress, ending with a complete event carrying the real chatId and preview URL.' },
        },
      },
    },
    '/api/build/artifact': {
      post: {
        operationId: 'generateBuildArtifact',
        summary: 'Generate one builder-pivot artifact (thesis, PRD, data model, etc.) from an idea',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['view', 'idea', 'track'],
                properties: {
                  view: { type: 'string', description: 'Which artifact to generate, e.g. thesis | wedge | prd | dataModel.' },
                  idea: { type: 'string' },
                  track: { type: 'string', enum: ['app', 'company'] },
                  companyName: { type: 'string' },
                  feedback: { type: 'string', description: 'Founder review notes, when regenerating an already-produced artifact.' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: 'The generated artifact',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    view: { type: 'string' },
                    content: { type: 'object', description: 'Parsed JSON, shaped per the requested artifact schema.' },
                    provider: { type: 'string' },
                    model: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/build/ask': {
      post: {
        operationId: 'askCody',
        summary: 'Ask Cody a question about a company, with real persistent memory of the thread',
        security: [],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['question', 'idea'],
                properties: {
                  question: { type: 'string' },
                  idea: { type: 'string' },
                  companyName: { type: 'string' },
                  track: { type: 'string', enum: ['app', 'company'] },
                  companyId: { type: 'string' },
                  chatId: { type: 'string' },
                },
              },
            },
          },
        },
        responses: {
          '200': {
            description: "Cody's answer",
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: { answer: { type: 'string' }, model: { type: 'string' }, provider: { type: 'string' } },
                },
              },
            },
          },
        },
      },
      get: {
        operationId: 'getAskThread',
        summary: 'Rehydrate a persisted Ask Cody conversation thread',
        security: [],
        parameters: [
          { name: 'companyId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'chatId', in: 'query', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': {
            description: 'The thread so far',
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    turns: {
                      type: 'array',
                      items: {
                        type: 'object',
                        properties: {
                          role: { type: 'string', enum: ['user', 'assistant'] },
                          text: { type: 'string' },
                          createdAt: { type: 'string', format: 'date-time' },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/api/build/systems': {
      get: {
        operationId: 'getBusinessSystems',
        summary: "Read a company's real, live business-systems state",
        description: 'Never fabricates counts — a freshly generated company genuinely shows zero deals/invoices/tickets until the nightly loop or founder activity produces real data.',
        security: [],
        parameters: [
          { name: 'companyId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'idea', in: 'query', schema: { type: 'string' }, description: 'Drives which primitives are shown for this company.' },
        ],
        responses: { '200': { description: "The company's real system cards and counts" } },
      },
    },
    '/api/preview/{chatId}': {
      get: {
        operationId: 'getPreview',
        summary: 'The real, running rendered preview of a generated app',
        security: [],
        parameters: [{ name: 'chatId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'text/html — the rendered app, or an honest "still generating" / "unavailable" state.' } },
      },
    },
    '/api/build/enroll': {
      post: {
        operationId: 'enrollNightlyLoop',
        summary: "Enroll a company in Cody's nightly autonomous work loop",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['companyId', 'companyName', 'track'],
                properties: {
                  companyId: { type: 'string' },
                  companyName: { type: 'string' },
                  track: { type: 'string', enum: ['app', 'company'] },
                  goal: { type: 'string' },
                },
              },
            },
          },
        },
        responses: { '200': { description: 'Enrollment confirmed' } },
      },
    },
    '/api/build/secrets': {
      get: {
        operationId: 'listAppSecrets',
        summary: "List a founder's deployed app's runtime secrets (masked)",
        security: [{ sessionCookie: [] }],
        parameters: [{ name: 'companyId', in: 'query', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: 'Masked secret list — plaintext values never leave the server.' } },
      },
      post: {
        operationId: 'setAppSecret',
        summary: "Add or edit one of a founder's deployed app's runtime secrets",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['companyId', 'name', 'value'],
                properties: { companyId: { type: 'string' }, name: { type: 'string' }, value: { type: 'string' } },
              },
            },
          },
        },
        responses: { '200': { description: 'Saved' } },
      },
      delete: {
        operationId: 'deleteAppSecret',
        summary: "Delete one of a founder's deployed app's runtime secrets",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['companyId', 'name'], properties: { companyId: { type: 'string' }, name: { type: 'string' } } },
            },
          },
        },
        responses: { '200': { description: 'Deleted' } },
      },
    },
    '/api/build/redeploy': {
      post: {
        operationId: 'redeployApp',
        summary: "Redeploy the current version of a founder's app",
        security: [{ sessionCookie: [] }],
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: { type: 'object', required: ['companyId'], properties: { companyId: { type: 'string' } } },
            },
          },
        },
        responses: { '200': { description: 'Redeploy triggered and health-checked' } },
      },
    },
    '/api/build/deck': {
      get: {
        operationId: 'exportPitchDeck',
        summary: "Export a company's pitch deck as an editable PowerPoint (paid feature)",
        security: [{ sessionCookie: [] }],
        parameters: [
          { name: 'companyId', in: 'query', required: true, schema: { type: 'string' } },
          { name: 'format', in: 'query', schema: { type: 'string', enum: ['pptx', 'txt'] } },
        ],
        responses: {
          '200': { description: 'The deck file stream' },
          '402': { description: 'Payment required — this company has no paid plan' },
        },
      },
    },
  },
  components: {
    securitySchemes: {
      sessionCookie: {
        type: 'oauth2',
        description:
          "A real founder session, obtained via core's OAuth2.1/PKCE authorization-code flow " +
          '(see /.well-known/oauth-authorization-server). Builder adopts the resulting tokens into ' +
          'a session cookie — there is no separate bearer-token API-key scheme for these endpoints today.',
        flows: {
          authorizationCode: {
            authorizationUrl: 'https://api.ainative.studio/oauth/authorize',
            tokenUrl: 'https://api.ainative.studio/v1/oauth/token',
            scopes: { openid: 'Verify identity', profile: 'Read basic profile', email: 'Read email address' },
          },
        },
      },
    },
  },
}

export async function GET() {
  return Response.json(spec, {
    headers: { 'Cache-Control': 'public, max-age=3600' },
  })
}

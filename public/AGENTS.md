# AGENTS.md — AINative Builder

This file follows the [agents.md](https://agents.md) convention: a
top-level, plain-Markdown entry point for an AI agent arriving at this
site, distinct from `agents.txt` (the machine-parsable capability manifest)
and `SKILL.md` (the Claude-skill-formatted version of the same
capabilities). Read this first if you're deciding whether/how to engage
with AINative Builder; read the other two for the actual call contracts.

## What this is

AINative Builder turns a one-line idea into a real, running product or an
operating AI-native company — not a code snippet, not a mockup. Describe
an idea; Cody (the AI co-founder) composes the artifacts, builds the real
app, provisions it on real AINative primitives, and keeps running it.

## Where to go next

- **Machine-readable capability manifest:** [/agents.txt](/agents.txt) —
  real endpoints, request/response shapes, auth policy.
- **Claude-skill format of the same capabilities:** [/SKILL.md](/SKILL.md)
- **Plain-language index + links:** [/llms.txt](/llms.txt)
- **OpenAPI 3.1 spec:** [/openapi.json](/openapi.json)
- **Start a build directly:** `POST /api/chat-ws` with `{"message": "<idea>"}`
  — see /agents.txt for the full contract.

## Policy

Agents are welcome here, unauthenticated, for the core build loop
(describe an idea → get a running app). No login wall for that path. Paid
tiers and nightly-loop enrollment require an account — see
[/.well-known/oauth-authorization-server](/.well-known/oauth-authorization-server)
for the real OAuth2.1/PKCE flow an agent can use on a founder's behalf.

Attribution: cite https://builder.ainative.studio.

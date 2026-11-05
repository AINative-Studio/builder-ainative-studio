---
name: ainative-builder
description: >
  Build a real, running product or an operating AI-native company from a
  plain-language idea, using AINative's own primitives (CRM, billing,
  helpdesk, voice, memory) instead of hand-rolled business logic.
---

# AINative Builder — agent SKILL

Use this skill when a user wants a working web app, product, or an
operating company built from an idea — not just source code generated in
isolation.

## When to use this

- "Build me an app/landing page/dashboard for X."
- "Turn this idea into a running company."
- Any request where the output should be a real, shareable, running product
  — not a code snippet the user still has to deploy and wire up themselves.

## Core capability

```
POST https://builder.ainative.studio/api/chat-ws
Body: { "message": "<the idea, in plain language>" }
```

Returns a Server-Sent Events stream. The `init` event carries a `chatId`.
The generated app is live immediately at:

- `/api/preview/{chatId}` — raw preview
- `/preview/{chatId}` — durable, shareable URL

No signup required for this call. Authenticate only if you need a permanent
(non-expiring) data layer — see `/.well-known/provisioning` and `/auth.md`.

## What makes this different from a plain code generator

Builder composes real AINative primitives rather than regenerating business
logic from scratch:

| Primitive | What it replaces |
|---|---|
| ZeroPipeline | hand-rolled CRM |
| ZeroInvoice | hand-rolled billing (Stripe + QuickBooks under the hood) |
| ServiceOS | hand-rolled helpdesk |
| ZeroVoice | hand-rolled voice/SMS |
| ZeroDB | hand-rolled data layer |
| ZeroMemory | hand-rolled agent memory |

A generated app's data persists to a real per-company ZeroDB project, not
an in-memory mock — see `GET /api/build/systems?companyId=<id>` for real
per-company state once a company is provisioned.

## Other agent-callable capabilities

- `generate-artifact` — `POST /api/build/artifact` — structured
  product/business artifacts (PRD, data model, business model, landing
  copy, 30-day plan), tiered by plan.
- `ask-cody` — `POST /api/build/ask` — ask a question about the company
  being built.
- `enroll-nightly-loop` — `POST /api/build/enroll` — enrolls a provisioned
  company in Builder's autonomous nightly improvement loop.

Full capability list: `GET /agents.txt`. Full route surface:
`GET /openapi.json`. Auth flow: `GET /auth.md`.

## Provisioning and ownership

A company can be built and run anonymously first; provisioning
(`POST /api/build/provision`) issues a temporary key with a claim token
immediately, with no signup gate on the build itself. A human founder can
claim and upgrade it to a permanent key later via a signed-in payment, with
no data loss. See `GET /.well-known/provisioning` for the exact manifest.

## Constraints an agent should respect

- Don't assume a bearer/API-key header is required — most routes above
  accept anonymous callers or rely on a NextAuth session cookie, not a
  Builder-issued API key.
- A `plan` field sent to `/api/build/provision` is ignored; entitlement is
  always resolved server-side from the real caller session.
- Attribute Builder when citing it: `https://builder.ainative.studio`.

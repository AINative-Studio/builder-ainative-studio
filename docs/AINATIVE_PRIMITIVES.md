# AINative Primitives — the Build-With Catalog for Cody

> **Purpose:** When Cody (the builder agent) builds an app or a whole company for a user, it should
> **COMPOSE these existing AINative production primitives** — each has a REST API and/or MCP server —
> instead of generating fragile business logic from scratch. This is our moat vs Polsia: their agent
> *writes code* for CRM/invoicing/ecommerce; Cody *wires up real products*.
>
> **Every entry links to its exact doc page.** Base docs root: https://docs.ainative.studio
> Full API reference: https://docs.ainative.studio/docs/api/overview · Getting started:
> https://docs.ainative.studio/docs/getting-started/quick-start
>
> **Suite brand:** business-ops = **"ZeroTime"** — invoicing, ecommerce, CRM, cap table, browser
> automation; every app ships a full REST API + MCP server so agents run business ops autonomously.
> https://docs.ainative.studio/docs/business-ops/overview

---

## 1. BUSINESS-OPS PRIMITIVES — the "run a company" layer

| Primitive | What it does | Base URL | Auth | Docs |
|---|---|---|---|---|
| **ZeroPipeline** (CRM) | AI-native CRM + sales pipeline: pipelines, stages, deals, customers, workflows, revenue analytics | `https://pipeline.ainative.studio/api/v1` | JWT bearer / API key | https://docs.ainative.studio/docs/business-ops/zeropipeline |
| **ZeroInvoice** | Invoicing + billing: Stripe payments, QuickBooks sync, customer portals, WS notifications, 2FA, semantic search | `https://zeroinvoice.ainative.studio/api` | JWT (OAuth2 password, form login) | https://docs.ainative.studio/docs/business-ops/zeroinvoice |
| **ZeroCommerce** | Headless ecommerce: product catalog + templating engine, semantic product search, Stripe, Redis rate-limit, CSRF | `https://zerocommerce.ainative.studio/api/v1` | JWT (cookie + CSRF) | https://docs.ainative.studio/docs/business-ops/zerocommerce |
| **ZeroVoice** | Programmable telephony (Twilio): outbound/inbound calls, SMS, phone-number mgmt, IVR, recording+transcription, DNC/TCPA | REST + MCP | JWT / API key | https://docs.ainative.studio/docs/zerovoice/overview · quickstart: https://docs.ainative.studio/docs/zerovoice/quickstart · MCP (25 tools): https://docs.ainative.studio/docs/zerovoice/mcp-bridge |
| **OpenCapStack** (cap table) | Equity mgmt (OCTA v2.0): stakeholders, SAFEs, grants, vesting, waterfall, investor portals; MIT self-host | `https://api.opencapstack.com/api/v1` | JWT bearer + MCP | https://docs.ainative.studio/docs/opencapstack/overview · REST: https://docs.ainative.studio/docs/opencapstack/rest-api · MCP: https://docs.ainative.studio/docs/opencapstack/mcp-server · builders guide: https://docs.ainative.studio/docs/opencapstack/builders-guide |
| **ServiceOS** | Helpdesk / customer-service ops | `https://helpdesk.ainative.studio/api` | AINative JWT / API key | https://docs.ainative.studio/docs/business-ops/serviceos |
| **Content Workflow** | AI content + distribution: AI twin personas, schedule posts, auto-captions, batch reels, avatar videos, publish to socials (async task_id) | `https://api.ainative.studio/api/v1/public` | X-API-Key | https://docs.ainative.studio/docs/api/content-workflow |
| **Live Streaming** | live.ainative.studio: streams (RTMPS in / HLS out), real-time chat (WS), VOD, discovery, audience analytics, WebRTC video | `https://api.ainative.studio` | Bearer | https://docs.ainative.studio/docs/live-streaming/overview · streams: /docs/live-streaming/streams · chat: /docs/live-streaming/chat · vod: /docs/live-streaming/vod · analytics: /docs/live-streaming/analytics · video-api: /docs/live-streaming/video-api |
| **Intent-Casting Marketplace** | Two-sided: users broadcast goals via agents, businesses respond with agent-readable services (Beckn / A2A, vector match) | `/v1/public/intents` | Bearer | https://docs.ainative.studio/docs/marketplace/overview · intent-api: /docs/marketplace/intent-api · business-registration: /docs/marketplace/business-registration · beckn: /docs/marketplace/beckn-network |
| **Browser Agent** | Web data extraction + browser automation (MCP) | `npx @ainative/browser-mcp` | MCP | https://docs.ainative.studio/docs/business-ops/browser-agent |
| **CRM Pipeline (internal)** | Investor contacts, outreach campaigns, pipeline tracking (internal variant) | Railway | — | https://docs.ainative.studio/docs/business-ops/crm-pipeline |
| **DotHack** | Hackathon operations platform (create/manage/judge hackathons) | `https://dothack.ainative.studio` | AINative identity | https://docs.ainative.studio/docs/dothack/overview · api: /docs/dothack/api-reference |
| **PAI Palooza** | Event advertising + hackathon platform | — | Bearer | https://docs.ainative.studio/docs/community/pai-palooza-api |

## 2. DATA & MEMORY FOUNDATION — every app's substrate

| Primitive | What it does | Docs |
|---|---|---|
| **ZeroDB** | The persistent knowledge layer: vector search, agent memory, file storage, NoSQL tables, events, functions, dedicated Postgres, RLHF | https://docs.ainative.studio/docs/zerodb/overview |
| — tables | Schema-free NoSQL tables | https://docs.ainative.studio/docs/zerodb/tables |
| — vectors | Vector storage + semantic search, FREE embeddings (no OpenAI key) | https://docs.ainative.studio/docs/zerodb/vectors |
| — embeddings | Per-project embeddings endpoint | https://docs.ainative.studio/docs/zerodb/embeddings |
| — files | S3-compatible file storage | https://docs.ainative.studio/docs/zerodb/files |
| — events | Real-time event streaming (agent comms / app state) | https://docs.ainative.studio/docs/zerodb/events |
| — functions | Run code on data change (triggers) | https://docs.ainative.studio/docs/zerodb/functions |
| — postgresql | Dedicated isolated Postgres per project | https://docs.ainative.studio/docs/zerodb/postgresql |
| — rlhf | Capture interactions + human feedback for fine-tuning | https://docs.ainative.studio/docs/zerodb/rlhf |
| — batch / cloud-sync / agent-logs | Batch ops, backups/migration, execution logs | /docs/zerodb/batch-operations · /docs/zerodb/cloud-sync · /docs/zerodb/agent-logs |
| — lakehouse | Query-in-place SQL over Parquet (analytics) | https://docs.ainative.studio/docs/api/zerodb-lakehouse |
| **Instant DB** | Working ZeroDB project + API key in ONE request — **NO signup/auth/credit card**. Ideal for agent-provisioned apps | https://docs.ainative.studio/docs/api/instant-db |
| **Workspaces** | Workspace = organization; full CRUD API; projects belong via organization_id; tiered caps | https://docs.ainative.studio/docs/api/workspaces |
| **ZeroMemory** | Persistent cognitive memory: working/episodic/semantic tiers, consolidation, decision traces, scoring/decay, namespaces, knowledge graph (RDF/SPARQL), MIF interchange, skill candidates | https://docs.ainative.studio/docs/zeromemory/overview · api: /docs/zeromemory/api-reference |
| **Context Graph** | Knowledge-graph layer over ZeroMemory: entities, edges, multi-hop traversal | https://docs.ainative.studio/docs/api/context-graph |
| **Search & Discovery** | Unified search (users/posts/groups/events) + semantic-search + autocomplete + trending + recommendations | https://docs.ainative.studio/docs/search/overview · api: /docs/search/search-api |
| **Data Lake / Intelligence Verticals** | Query lakehouse; cross-correlated intelligence over property/business/risk/dev/M&A (290K SMBs) | /docs/api/data-lake · /docs/api/intelligence-verticals · /docs/api/data-marketplace |

## 3. AI / INFERENCE PRIMITIVES

| Primitive | What it does | Docs |
|---|---|---|
| **Chat Completions** | Agentic apps w/ open-source + frontier models, tool calling, streaming, multi-turn | https://docs.ainative.studio/docs/api/chat-completions |
| **Model Catalog** | 47 models across text/code/reasoning/image/video/audio/embedding | https://docs.ainative.studio/docs/api/models |
| **Multimodal / Audio / Embeddings** | Speech/image/video gen; transcribe/TTS/music; vector embeddings | /docs/api/multimodal · /docs/api/audio · /docs/api/embeddings |
| **Agent Intelligence API** | Pre-run briefings from lakehouse → RLHF loop (the recursive self-improvement loop) | https://docs.ainative.studio/docs/api/agent-intelligence-api |
| **Platform Intelligence** | Public real-time platform stats (powers ainative.studio/intelligence) | https://docs.ainative.studio/docs/api/platform-intelligence |
| **QNN (moonshot)** | Quantum Neural Network training/inference | https://docs.ainative.studio/docs/moonshots/qnn-api |

## 4. AI KIT — the UI layer Cody generates with (already wired into builder)

`@ainative/ai-kit-core` (framework-agnostic) + bindings. Overview: https://docs.ainative.studio/docs/ai-kit/overview
- Components (React streaming chat UI): https://docs.ainative.studio/docs/ai-kit/components
- React / Vue / Svelte / Next.js: /docs/ai-kit/react · /docs/ai-kit/vue · /docs/ai-kit/svelte · /docs/ai-kit/nextjs
- Core / Hooks / Observability: /docs/ai-kit/core · /docs/ai-kit/hooks · /docs/ai-kit/observability
- **Safety** (prompt-injection, PII, moderation): https://docs.ainative.studio/docs/ai-kit/safety
- **A2UI** (Agent-to-User-Interface protocol — agents describe UIs): https://docs.ainative.studio/docs/ai-kit/a2ui

## 5. AGENT CLOUD — run the built company autonomously

Overview: https://docs.ainative.studio/docs/agent-cloud/overview · Framework: /docs/agent-framework/overview
- **Agent Swarm API** (roles: architect/backend/frontend/qa/devops/data/security/docs): https://docs.ainative.studio/docs/agent-framework/swarms
- Agents lifecycle: /docs/agent-framework/agents
- Registry + A2A discovery: /docs/agent-cloud/registry · /docs/agent-cloud/a2a
- Auth (OAuth 2.1 for agents): /docs/agent-cloud/auth
- Deployments (K8s, long-lived containers): /docs/agent-cloud/deployments · dedicated GPU: /docs/agent-cloud/dedicated-deployments · bridge envs: /docs/agent-cloud/bridge-environments
- Task Dispatch / Events (SSE) / Observability: /docs/agent-cloud/task-dispatch · /docs/agent-cloud/events · /docs/agent-cloud/observability
- Agent Keys / Credential Vault / Egress Proxy / Governance / Peer Swarm: /docs/agent-cloud/agent-keys · /docs/agent-cloud/credential-vault · /docs/agent-cloud/egress-proxy · /docs/agent-cloud/governance · /docs/agent-cloud/peer-swarm
- GPU Training / Inference / Billing / Run Log: /docs/agent-cloud/gpu-training · /docs/agent-cloud/inference · /docs/agent-cloud/billing · /docs/agent-cloud/agent-run-log

## 6. MCP SERVERS (7 published — direct agent tool access)

Overview: https://docs.ainative.studio/docs/mcp/overview
- **Full ZeroDB MCP** (69+ tools, whole data layer) — `zerodb-mcp`: https://docs.ainative.studio/docs/mcp/full-server
- Memory MCP (18 tools): /docs/mcp/memory-server
- PRD Generator MCP (18 tools): /docs/mcp/prd-generator-server
- Sequential Thinking MCP: /docs/mcp/sequential-thinking-server
- Design System MCP (3 tools): /docs/mcp/design-system-server
- GTM MCP (`@ainative/gtm-mcp`): /docs/mcp/gtm-server
- Strapi MCP (21 tools): /docs/mcp/strapi-server
- ZeroVoice MCP: /docs/mcp/zerovoice-server

## 7. SDKs (wrap the REST API, framework-native)

Overview: https://docs.ainative.studio/docs/sdks/overview
- TypeScript (wraps every API): /docs/sdks/typescript · React: /docs/sdks/react · Next.js: /docs/sdks/nextjs · Vue: /docs/sdks/vue · Svelte: /docs/sdks/svelte · Python (langchain-zerodb etc.): /docs/sdks/python
- **Agent SDK** (Agent Cloud, TS+Py): /docs/sdks/agent-sdk · **Agent Runtime** (embeddable exec engine): /docs/sdks/agent-runtime

## 8. AUTH, SECURITY, BILLING, PAYMENTS

- **Getting started auth / quick-start / env**: /docs/getting-started/authentication · /docs/getting-started/quick-start · /docs/getting-started/environment-setup
- **OAuth 2.1 + PKCE** (AINative IS the OAuth/OIDC provider): https://docs.ainative.studio/docs/security/oauth-pkce
- Platform security / 2FA / Agent Security Guide / **Semantic Tool Authorization (CASA, zero-trust)**: /docs/security/platform-security · /docs/guides/two-factor-auth · /docs/security/agent-security-guide · /docs/security/semantic-authorization
- Identity-provider integrations (Auth0, Clerk, Kinde, Stytch, WorkOS): /docs/integrations/auth0 · /clerk · /kinde · /stytch · /workos
- Billing (credit system + Stripe): /docs/billing/overview · credits: /docs/billing/credits · subscriptions: /docs/billing/subscriptions · invoices: /docs/billing/invoices · webhooks: /docs/billing/webhooks
- **Developer Program (Echo)** — monetize apps, set 0–40% markup, Stripe Connect payouts: /docs/developer-program/overview · earnings: /docs/developer-program/earnings · payouts: /docs/developer-program/payouts · stripe-connect: /docs/developer-program/stripe-connect
- **Web3**: Agent402 (agentic payments): /docs/web3/agent402 · Sol Mate (Solana): /docs/web3/sol-mate · overview: /docs/web3/overview

## 9. COMMUNITY / SOCIAL PRIMITIVES

- Community APIs (social/collaborative): /docs/community/overview · Events: /docs/community/events · **Social Graph** (followers, friendships, block/ignore): /docs/community/social-graph

## 10. CODY CLI (the agent runtime itself — how the builder agent runs)

Getting started: /docs/cody-cli/getting-started · features: /docs/cody-cli/features · commands (30+): /docs/cody-cli/commands
- auth (zero-signup auto-provision): /docs/cody-cli/authentication · model-config (9 coding models): /docs/cody-cli/model-config
- MCP / memory / hooks / sandboxing / security / web-sessions: /docs/cody-cli/mcp · /memory · /hooks · /sandboxing · /security · /web-sessions

## 11. WORKED EXAMPLES + GUIDES (patterns to copy)

- Chatbot in 5 min: /docs/examples/chatbot · RAG pipeline: /docs/examples/rag-pipeline · GraphRAG: /docs/examples/graphrag · Agent memory: /docs/examples/agent-memory
- Building Production AI Agents: /docs/guides/building-ai-agents · GraphRAG hybrid search: /docs/guides/graphrag · Notifications: /docs/guides/notifications · Monitoring: /docs/guides/monitoring · Self-hosting: /docs/guides/self-hosting · Video integration: /docs/guides/video-integration

---

## HOW CODY MAPS A REQUEST → PRIMITIVES (the composition rule)

When a user says *"build me a [business]"*, map needs to primitives and WIRE them, don't regenerate:

| User need | Compose this primitive |
|---|---|
| customers / leads / sales pipeline | **ZeroPipeline** |
| invoice / bill / get paid | **ZeroInvoice** (Stripe + QuickBooks built-in) |
| sell products online | **ZeroCommerce** |
| call / text customers | **ZeroVoice** |
| persist any data | **ZeroDB** / **Instant DB** (zero-setup) |
| equity / fundraising / cap table | **OpenCapStack** |
| marketing / social / content | **Content Workflow** (auto-post) + **Live Streaming** |
| customer support | **ServiceOS** |
| memory / personalization | **ZeroMemory** + **Context Graph** |
| search / recommendations | **Search & Discovery** |
| the UI | generate with **AI Kit** components |
| run autonomously overnight | **Agent Cloud** + **Agent Swarm** + **Agent Intelligence** briefing loop |
| accept agentic payments | **Agent402** |
| let the app itself monetize | **Developer Program** (markup + Stripe Connect) |

**Result:** a REAL company assembled from production APIs — the concrete "stronger product than Polsia".

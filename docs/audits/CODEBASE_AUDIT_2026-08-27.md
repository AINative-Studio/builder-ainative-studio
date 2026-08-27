# Codebase Audit — builder-ainative-studio — 2026-08-27

Full-repo wiring audit: every cataloged file classified as **active** (reachable on a live path), **dormant** (built and reachable in code but gated off / unreachable in practice), **orphaned** (zero importers/callers), or **test-only** (referenced only by tests/harnesses).

**Coverage note (honest):** this document consolidates per-slice catalogs for `app/api/**`, `app/**` (pages), `components/**`, `lib/build/**`, `lib/agent/**`, and `lib/**` (misc — catalog delivered through `lib/multi-file-parser.ts`; the tail of the lib slice — `lib/preview-store*`, `lib/professional-prompt`, `lib/services/**`, `contexts/`, `hooks/` — was not delivered and is NOT tabulated below, though several of those files are referenced in evidence cells). Test-coverage and docs sections are from a direct repo scan on 2026-08-27.

---

## 1. Executive summary

### Repo shape

Next.js App Router monorepo serving three generations of product in one tree:

1. **The live pivot (`/build`)** — Cody-driven company builder: `components/build/**` + `app/api/build/**` (40 routes) + `lib/build/**` (70 modules). Almost entirely active and well-wired. Codegen runs through one giant SSE route (`app/api/chat-ws`, 1,677 lines) with static quality gates.
2. **The legacy chat-first product (`/chats`, `home-client`)** — partially live (the `/chats` routes still work) but the 1,003-line `home-client.tsx` front door is orphaned since the #207 pivot, dragging the RLHF star dialog and upgrade banner into unreachability.
3. **A large stratum of built-but-never-wired capability** — a parallel JWT auth stack, a superseded `/api/zerodb` data plane, a skills marketplace, A2UI dynamic previews, an evidence/verification system, an enforcement-rules engine, a headless agent runtime with execution-based verification, and MCP provisioning — most of it directly relevant to current build-quality priorities.

### Counts (535 files cataloged)

| Status | Count | % |
|---|---|---|
| active | 419 | 78% |
| dormant | 40 | 7% |
| orphaned | 71 | 13% |
| test-only | 5 | 1% |

By slice: app/api 143 (95 active / 14 dormant / 33 orphaned / 1 test-only) · app pages 64 (52/6/3/3) · components 167 (138/5/23/1) · lib/build+lib/agent 86 (74/12/0/0) · lib misc 75 (60/3/12/0).

### The 10 most significant DORMANT capabilities

Features the product has already paid for that are one flag / one link / one wire away:

1. **`lib/agent/verify-loop.ts` — the only verification that actually RUNS generated code.** Read/Write/Edit/Bash repair agent ($0.75 budget, 6 turns, typecheck/build). Called in chat-ws (lines ~1171–1178) but only inside `isClaudeAgentFallbackEnabled()` — false in prod (`USE_CLAUDE_AGENT_FALLBACK`/`USE_CLAUDE_AGENT`/`AGENT_RUNTIME=cody` all unset). Live repair is parser-based re-prompting only.
2. **Headless agent runtime** (`lib/agent/claude-agent.ts`, `agent-runtime.ts`, `worktree-manager.ts`) — full stream-json agent with per-session worktrees, skipped in prod because `bedrockPrimary` (`CODY_USE_BEDROCK=1`, `CODY_AGENT_PRIMARY` unset) bypasses it even for complex prompts (cody-cli #239 deterministic 400 cited in-code).
3. **Trajectory capture with objective rewards** (`lib/agent/trajectory-capture.ts` → `trajectory-store.ts` → ZeroDB `cody_trajectories`) — execution-based (install/build/run) reward labeling for fine-tuning; collects nothing while the agent path is off. Paired with zero-consumer export endpoints `/api/rlhf/export`, `/api/agent/export`, `/api/agent/metrics`.
4. **MCP provisioning** (`lib/build/mcp-provision.ts` + `lib/mcp/ainative-mcp-client.ts`, #73) — Cody agentically calling `zerodb_create_project`/`zerodb_create_table` MCP tools; fully implemented, called from `/api/build/provision` line 112, inert without `ENABLE_MCP_PROVISION=1` + MCP key (absent from .env). Silently falls back to Instant-DB REST. The stated "Cody OPERATES primitives" differentiator, flag-off.
5. **Validation-subagent pipeline** (`lib/agent/subagents.ts` + `agent-profiles.ts` + `metrics.ts`) — hierarchical orchestrator → design/code/**validation** (review) subagents; `runOrchestratorAgent` is wired at chat-ws line 714 behind `USE_SUBAGENTS`, set to `false` in .env. An implemented review-agent turn nobody runs.
6. **Full-stack backend generator** (`app/api/fullstack/provision` + `fullstack-generator.service` + `schema-inference.service`, issue #36) — infers a data model from the prompt, auto-provisions ZeroDB tables, returns endpoints + auth scaffold + drop-in TS client. Zero callers; its two services import only each other. The backend half of full-stack generation, unwired from `/build`.
7. **Evidence-verification gate** (`app/api/evidence/verify` — test-only; `/evidence` gallery page + `components/evidence/*` — built but linked from nowhere) — verifies passing test-run/coverage/build evidence before a commit ("blocks false confidence"). CI-gate-shaped, directly relevant to TDD-for-generated-apps, never invoked from any pipeline.
8. **Enforcement-rules engine unreachable from UI** — `/api/rules/validate` + `auto-fix` (agent-action governance with a `testing` category and test-run/build/deploy action types) are exercised only from `app/settings/rules/page.tsx`, which has zero inbound links AND `/settings` redirects away to the SPA account screen; `/api/rules/stats` and `/violations` have zero callers.
9. **All 4 deployment webhooks + the alerts cron are unreachable**: `middleware.ts` (lines 116–145) session-gates every non-allowlisted `/api/*` route, so cookie-less external POSTs to `/api/webhooks/{vercel,netlify,railway,ainative}` and `/api/cron/alerts` are 401'd **before** their CRON_SECRET/HMAC checks run. Deploy-status updates and scheduled alerting are silently dead. (Related: `/api/build/nightly-loop` IS allowlisted and works, but no in-repo cron schedules it — the nightly loop depends on an external trigger.)
10. **Prompt A/B versioning without a steering wheel** — `/api/prompts` CRUD/activate has no UI and zero HTTP callers; the service side (`getActivePromptVersion`) is live only in the legacy `/api/chat`, NOT in the primary `/api/chat-ws` pipeline — prompt experiments cannot reach the main codegen path.

Runners-up: A2UI agent-driven preview system (WS route is a placeholder — App Router can't upgrade WebSockets; poll/action routes orphaned); auto-media generation behind unset `BUILD_MEDIA_ENABLED`; Meta CAPI no-op pending token; `/api/debug-auth` publicly allowlisted and leaking auth env metadata; `/admin/template-submissions` review queue with no nav entry; chunking pipeline wired but rarely firing because `analyzeComplexity` under-counts raw ideas.

### Orphaned files (71 — zero importers/callers; safe-to-delete candidates after confirmation)

**app/api (33):** `a2ui/action/route.ts`, `a2ui/poll/route.ts`, `artifacts/[id]/route.ts`, `auth/login/route.ts`, `auth/logout/route.ts`, `auth/register/route.ts`, `chat-llama/route.ts`, `chats-v2/route.ts`, `chats-v2/[chatId]/route.ts`, `credits/estimate/route.ts`, `deployments/[id]/route.ts`, `design-tokens/versions/route.ts`, `evidence/[id]/route.ts`, `evidence/[id]/artifacts/route.ts`, `export/route.ts`, `few-shot-examples/route.ts`, `few-shot-examples/[id]/route.ts`, `fullstack/provision/route.ts`, `preview/route.ts`, `preview/simple/[id]/route.ts`, `rules/stats/route.ts`, `rules/violations/route.ts`, `showcase/preview/route.ts`, `skills/route.ts`, `skills/[skillId]/route.ts`, `skills/[skillId]/rating/route.ts`, `skills/[skillId]/usage/route.ts`, `skills/recommend/route.ts`, `skills/search/route.ts`, `templates/[id]/route.ts`, `usage/route.ts`, `zerodb/[...path]/route.ts`, `zerodb/schema/[tableName]/route.ts`

**app pages (3):** `context-budget-demo/page.tsx`, `demo/page.tsx`, `storybook/page.tsx`

**components (23):** `ai-elements/{actions,branch,code-block,image,inline-citation,reasoning,response,source,task,tool}.tsx`, `aikit/{CodeBlock,StreamingIndicator}.tsx`, `aikit/types/index.ts`, `feedback-dialog.tsx`, `generated-landing.tsx`, `home/home-client.tsx`, `shared/chat-menu.tsx`, `skills/{skill-browser,skill-editor}.tsx`, `ui/{carousel,hover-card,sheet}.tsx`, `upgrade-banner.tsx`

**lib (12):** `data/templates/{index,admin-panel,blog-layout,ecommerce-product,landing-page,saas-dashboard}.ts`, `db/{seed-built-in-commands,seed-few-shot-examples,seed-templates}.ts`, `jobs/{prompt-rollback,quality-alerts,schema-change-detector}.ts`

Also broken (dead references, not files): `components/shared/chat-menu.tsx` + `chat-selector.tsx` fetch `/api/chat/fork` and `/api/chat/delete` which have **no route files**; `e2e/primitive-tooltips.spec.ts` targets `/test-components/primitive-chips`, a harness route that does not exist.

---

## 2. Per-directory catalog

### 2.1 `app/api/**` (143 routes)

| file | purpose | status | evidence |
|---|---|---|---|
| app/api/a2ui/route.ts | A2UI WebSocket endpoint for agent-driven previews — placeholder (App Router can't upgrade WS) | dormant | a2ui components build WS URL behind default-off toggle in preview-panel; route docblock admits placeholder |
| app/api/a2ui/action/route.ts | Forward A2UI user actions back to agent | orphaned | zero fetchers across client tree |
| app/api/a2ui/poll/route.ts | Long-polling A2UI fallback (in-memory queue) | orphaned | zero fetchers; in-memory Map non-instance-safe anyway |
| app/api/admin/errors/route.ts | Admin error-log dashboard API (drizzle error_logs) | active | app/admin/errors/page.tsx; weak email-substring admin check |
| app/api/admin/template-submissions/route.ts | List template submissions for admin review | active | admin/template-submissions/page.tsx fetches |
| app/api/admin/template-submissions/[id]/route.ts | Approve/reject a submission (promotes to templates) | active | same page PATCHes it |
| app/api/agent/export/route.ts | Export headless-agent runs as JSONL for fine-tuning (#57) | dormant | zero in-repo callers |
| app/api/agent/metrics/route.ts | Aggregated headless-agent run metrics (#57) | dormant | zero in-repo callers; no dashboard |
| app/api/artifacts/[id]/route.ts | Download evidence artifact file by DB id | orphaned | zero references outside the route |
| app/api/auth/[...nextauth]/route.ts | NextAuth handler re-export — THE live auth stack | active | middleware allows /api/auth/*; app-wide signIn |
| app/api/auth/ainative/authorize/route.ts | Sign-in-with-AINative OAuth2.1/PKCE kickoff | active | ainative-oauth-button + build Auth screen link to it |
| app/api/auth/ainative/callback/route.ts | OAuth callback: state check, code+PKCE exchange, NextAuth session | active | redirect target of authorize; imports signIn |
| app/api/auth/guest/route.ts | RETIRED guest sign-in (2026-08-27) — redirects to /login | active | deliberate retirement stub for legacy bookmarks |
| app/api/auth/login/route.ts | US-009 parallel JWT login (bcrypt + lib/auth-jwt) | orphaned | zero client callers; live app is NextAuth-only |
| app/api/auth/logout/route.ts | US-009/010 JWT logout | orphaned | zero client callers |
| app/api/auth/register/route.ts | US-009 parallel JWT registration | orphaned | zero client callers; live signup = /api/build/register |
| app/api/build/artifact/route.ts | Generate one pivot artifact (thesis/PRD/data model) w/ regen feedback (GR-16) | active | build components fetch it; public allowlisted |
| app/api/build/ask/route.ts | "Ask Cody" Live-dashboard chat w/ ZeroDB memory, backlog-grounded | active | screens/Live.tsx GET+POST |
| app/api/build/auto-mode/route.ts | Bounded autonomous run (1h/4h/8h/overnight) + progress polling | active | AutoModePanel.tsx; Business+ gated |
| app/api/build/backlog/route.ts | Per-company built-vs-queued backlog from idea-selected primitives (#287) | active | server-side self-fetch by ask route line 76 |
| app/api/build/brand/route.ts | Real brand generation (name/slug/tagline/color) (#207 FIX-1) | active | screens/Intake.tsx |
| app/api/build/checkout/route.ts | Stripe checkout via core public pricing | active | screens/Pricing.tsx |
| app/api/build/claim-subdomain/route.ts | Claim {slug}.ainative.studio — paid + signed-in gate (#78) | active | WebsitePanel.tsx; in-route plan re-read |
| app/api/build/company-app/route.ts | Generate landing app for Company track + register slug (#207 FIX-2) | active | build components fetch it |
| app/api/build/connect-domain/route.ts | BYO-domain to Railway service, DoH DNS pre-check (#53) | active | WebsitePanel.tsx (2 refs) |
| app/api/build/credits/route.ts | Freemium build-credit ledger, 402 on limit, GR-15 bonus | active | 5 client refs; self-gates anonymous → 401 |
| app/api/build/danger/route.ts | Pause/resume/offline/delete company w/ typed confirm | active | DangerZone.tsx |
| app/api/build/deck/route.ts | Paid pitch-deck .pptx export (402 unpaid) | active | DocumentsPanel.tsx |
| app/api/build/documents/route.ts | Persistent Documents/Reports library (ZeroDB build_documents) (#64) | active | DocumentsPanel.tsx (2 refs) |
| app/api/build/domains/route.ts | Namecheap domains proxy: suggest/check/purchase (#240) | active | 5 client refs |
| app/api/build/enroll/route.ts | Enroll company in nightly loop ("Hire the swarm") | active | screens/Live.tsx |
| app/api/build/export/route.ts | Download own ZeroDB project data JSON/CSV (#63.C) | active | owner-only session in-route |
| app/api/build/help/route.ts | Help Center RAG over FAQ w/ cited sources (#60) | active | help components; public + agent-queryable |
| app/api/build/intelligence/route.ts | Same-origin proxy for core platform-intelligence stats | active | 1 client ref; degrades to empty stats |
| app/api/build/lead/route.ts | Anonymous email capture + gclid/Meta CAPI conversions (#207) | active | 1 client ref; pre-paywall public |
| app/api/build/learning/route.ts | Recursive-loop learning rollup (#270), full detail = Bearer CRON_SECRET | dormant | zero in-repo fetchers; consumer is external nightly briefing |
| app/api/build/media/route.ts | Auto-media routines + asset list (ZeroDB build_media) (#54) | active | MediaPanel (2 refs); degrades to disabled |
| app/api/build/media/upload/route.ts | Founder photo upload (5MB, image-only) + presign serve (#323) | active | 2 refs; real account required |
| app/api/build/migrate/route.ts | Guest→real-account company slug migration (#49) | active | 1 client ref |
| app/api/build/my-companies/route.ts | Founder's companies index w/ ownership handles (#253) | active | 3 refs (MyCompanies) |
| app/api/build/nightly-loop/route.ts | Nightly autonomous-loop cron target (CRON_SECRET-gated) | active | external cron target; allowlisted then self-auths |
| app/api/build/nightshift/route.ts | Morning summary from last real nightly run | active | 1 ref |
| app/api/build/profile/route.ts | Founder profile r/w against core /auth/me (#57) | active | 2 refs |
| app/api/build/provision/route.ts | Per-company Instant-DB provisioning, sk_/tmp_ keys (#243) | active | 3 refs; raw key never persisted to registry |
| app/api/build/redeploy/route.ts | Redeploy current version on Railway + health check (#63.A) | active | 1 ref; owner-only |
| app/api/build/referral/route.ts | Refer & Earn code/link/stats + attribution (#59) | active | 2 refs; self-referral rejected |
| app/api/build/register-app/route.ts | Register slug→chatId; resolves deploy URL (#213) | active | 2 refs |
| app/api/build/register/route.ts | Real signup vs CORE w/ gclid/utm attribution (#74) | active | 3 refs (Auth screen) |
| app/api/build/secrets/route.ts | Railway env-var management, masked reads (#63.B) | active | 3 refs; owner-only |
| app/api/build/subscription/portal/route.ts | Stripe billing portal via core (#253) | active | 3 refs |
| app/api/build/subscription/status/route.ts | Core plan → Builder ActivePlan mapping (#251) | active | 4 refs |
| app/api/build/subscription/verify/route.ts | Post-checkout fulfillment: confirm Stripe, deploy Railway, credit referral | active | 1 ref (Live after ?upgraded=1) |
| app/api/build/swarm/route.ts | Real platform agent-swarm attempt for paid tiers; honest fallback | active | 3 refs; becomes fully real when core#6422 fixed |
| app/api/build/systems/route.ts | Idea-driven business-systems state w/ real ZeroDB counts (#233/#288) | active | 2 refs |
| app/api/build/tasks/route.ts | Real Tasks/Backlog store (ZeroDB build_tasks) (#55) | active | 1 client ref + swarm/nightly writers |
| app/api/build/versions/route.ts | Deploy version history + health-verified rollback (#62) | active | 3 refs |
| app/api/chat-llama/route.ts | Anonymous Llama streaming chat w/ per-IP limits | orphaned | zero fetchers; superseded by /api/chat-ws |
| app/api/chat-ws/route.ts | THE main codegen pipeline (1,677 lines, SSE): verify/enhance, RAG, decomposition, model-select, obedience gate, retry loop, checkpoints | active | 6 refs; public allowlisted; BW-1 RLHF capture path |
| app/api/chat/route.ts | Older single-shot generation w/ RLHF logGeneration + A/B prompt versioning | active | hooks/use-chat.ts → chat-detail-client |
| app/api/chat/ownership/route.ts | Record chat ownership / anonymous IP log | active | home-client.tsx:490 |
| app/api/chats/route.ts | List chats (preview store + ZeroDB merge) | active | 5 refs |
| app/api/chats/[chatId]/route.ts | Get one chat w/ ownership check | active | 5 refs; 401 in-route |
| app/api/chats/[chatId]/code/route.ts | Extract generated code from stored preview | active | code-viewer.tsx:31 |
| app/api/chats-v2/route.ts | US-002 JWT-auth chat list (parallel auth stack) | orphaned | zero references repo-wide |
| app/api/chats-v2/[chatId]/route.ts | US-002 JWT single chat GET/DELETE | orphaned | zero references |
| app/api/commands/route.ts | Agent-command palette CRUD | active | command-client → command-palette → layout |
| app/api/commands/[commandId]/route.ts | Get/update/delete one command | active | via command-client |
| app/api/commands/[commandId]/execute/route.ts | Execute stored command w/ variable substitution | active | 1 ref via command-client |
| app/api/commands/[commandId]/favorite/route.ts | Toggle favorite | active | 1 ref |
| app/api/commands/recent/route.ts | Recently executed commands | active | 1 ref |
| app/api/context/budget/route.ts | Context-budget introspection | active | budget-dashboard + demo page (demo-only surface) |
| app/api/context/optimize/route.ts | Token-usage optimization suggestions | active | budget-dashboard + demo page |
| app/api/context/preload-cost/route.ts | Pre-load cost calc | active | demo page only |
| app/api/context/track/route.ts | Track context item events | active | demo page only |
| app/api/context/unload/route.ts | Unload context items | active | 2 refs (budget-dashboard) |
| app/api/credentials/route.ts | US-071 deploy-platform credentials list/save | active | deploy-dialog.tsx (4 refs) |
| app/api/credentials/[id]/route.ts | Update/delete credential | active | 1 ref |
| app/api/credentials/[id]/test/route.ts | Test credential connection | active | 1 ref |
| app/api/credits/route.ts | Authoritative per-user credit ledger (#312) | active | user-nav.tsx:38, Account.tsx:114 |
| app/api/credits/estimate/route.ts | Pre-generation credit cost estimate | orphaned | zero references repo-wide |
| app/api/cron/alerts/route.ts | Scheduled alert check (Bearer CRON_SECRET) | dormant | zero callers AND middleware 401s cookie-less callers before CRON check |
| app/api/db/[table]/route.ts | ZeroDB CRUD proxy for GENERATED apps; per-app signed data token (#331) | active | the runtime data plane; 10+ refs; prompted via professional-prompt + primitive-catalog |
| app/api/debug-auth/route.ts | Diagnostic dump of auth env state | dormant | no caller; PUBLICLY allowlisted; leaks env metadata |
| app/api/deploy/route.ts | US-067..070 deploy generation to Vercel/Netlify/Railway/AINative | active | deploy-dialog.tsx:189 |
| app/api/deployments/route.ts | List deployments (Epic 9) | active | deployments/page.tsx:108 |
| app/api/deployments/[id]/route.ts | Get/cancel one deployment | orphaned | zero fetchers |
| app/api/design-tokens/route.ts | List design tokens | active | design-tokens page |
| app/api/design-tokens/[tokenId]/route.ts | Get / set-active / delete token | active | 1 ref |
| app/api/design-tokens/[tokenId]/activate/route.ts | Activate token | active | 1 ref |
| app/api/design-tokens/[tokenId]/revert/route.ts | Revert to previous version | active | 1 ref |
| app/api/design-tokens/[tokenId]/versions/route.ts | Version history per token | active | page.tsx:148 |
| app/api/design-tokens/upload/route.ts | US-024 upload custom design system | active | upload-dialog posts |
| app/api/design-tokens/versions/route.ts | US-025 cross-token version listing (parallel verifyJWT auth) | orphaned | zero fetchers; auth-incompatible with live session |
| app/api/evidence/route.ts | Evidence list/filter + capture ("proof of work") | active | evidence-timeline.tsx:56 + gallery:70 |
| app/api/evidence/[id]/route.ts | Get one evidence record | orphaned | zero fetchers |
| app/api/evidence/[id]/artifacts/route.ts | Artifacts on an evidence record | orphaned | zero fetchers |
| app/api/evidence/verify/route.ts | Verify passing evidence exists before a commit (coverage threshold) | test-only | only __tests__/api/evidence-verify.test.ts; unwired CI-gate capability |
| app/api/export/route.ts | POST files/chatId → project zip | orphaned | only /api/export/${id} is ever called |
| app/api/export/[id]/route.ts | US-066 download generation as Next.js project zip | active | export-button.tsx:27; owner check |
| app/api/few-shot-examples/route.ts | US-028 few-shot example CRUD | orphaned | zero references outside routes + one doc |
| app/api/few-shot-examples/[id]/route.ts | US-028 single example | orphaned | zero callers |
| app/api/fullstack/provision/route.ts | Issue #36: infer data model from prompt, auto-provision ZeroDB tables, return endpoints + TS client | orphaned | zero callers; its service pair imports only each other |
| app/api/generation/[id]/files/route.ts | Durable multi-file map read (ZeroDB files_json fallback) for Sandpack rehydrate (#333) | active | 1 ref in workspace client |
| app/api/health/route.ts | Liveness + readiness probe | active | Railway probes + 4 refs |
| app/api/help/stuck/route.ts | "I'm stuck" keyword retrieval w/ deep links (#321) | active | ImStuck.tsx + guides page; documented ranker seam |
| app/api/plan/route.ts | Signed-in user's tier/trial/usage | active | workspace-switcher.tsx:86 |
| app/api/preview/route.ts | POST code → one-shot HTML preview (legacy) | orphaned | no fetcher POSTs plain /api/preview |
| app/api/preview/[id]/route.ts | THE preview renderer (1,593 lines): Babel/Sandpack, validation, per-app data token (#331) | active | iframed everywhere (showcase, build Preview, home-client) |
| app/api/preview/simple/[id]/route.ts | Simplified preview (strip imports/types) | orphaned | zero callers |
| app/api/projects/route.ts | List/create AINative projects w/ workspace scope | active | projects-client.tsx:85, link-project.ts:39 |
| app/api/prompts/route.ts | US-015 prompt-version CRUD w/ A/B percentages | dormant | zero HTTP callers; service live via /api/chat only |
| app/api/prompts/[id]/route.ts | Get/update prompt version | dormant | zero callers |
| app/api/prompts/[id]/activate/route.ts | Activate prompt version | dormant | activation only via direct API call |
| app/api/rlhf/export/route.ts | JSONL export (OpenAI chat format) for fine-tuning | dormant | zero in-repo callers |
| app/api/rlhf/insights/route.ts | RLHF aggregate insights | active | insights/page.tsx:49 |
| app/api/rlhf/submit-feedback/route.ts | Store RLHF ratings to ZeroDB | active | feedback-dialog:49, FeedbackPulse:55, home-client:751 |
| app/api/rules/route.ts | Enforcement rules list/create (git/testing/security categories) | active | settings/rules/page.tsx:87 |
| app/api/rules/[ruleId]/route.ts | Get/update/delete rule | active | page.tsx:114 |
| app/api/rules/validate/route.ts | Validate agent action against rules | active | page.tsx:159 only (settings test UI) — governance seam |
| app/api/rules/auto-fix/route.ts | Auto-fix rule violations | active | page.tsx:216 |
| app/api/rules/stats/route.ts | Enforcement statistics | orphaned | docs only |
| app/api/rules/violations/route.ts | Violation history | orphaned | docs only |
| app/api/showcase/route.ts | Showcase gallery list, quality-filtered | active | showcase pages (2 refs) |
| app/api/showcase/preview/route.ts | Return code for showcase iframe | orphaned | cards now iframe /api/preview/{chatId} |
| app/api/skills/route.ts | Skills marketplace list/create | orphaned | only unimported skill-browser calls it |
| app/api/skills/[skillId]/route.ts | Skill CRUD w/ stats + ratings | orphaned | skill-browser only, itself unimported |
| app/api/skills/[skillId]/rating/route.ts | Rate a skill | orphaned | zero callers |
| app/api/skills/[skillId]/usage/route.ts | Track skill usage | orphaned | zero callers |
| app/api/skills/recommend/route.ts | Context-based skill recommendations | orphaned | zero callers |
| app/api/skills/search/route.ts | Advanced skill search | orphaned | zero callers |
| app/api/templates/route.ts | List/filter active templates | active | templates/page.tsx:51 (login-gated by middleware) |
| app/api/templates/[id]/route.ts | Get single template + usage count | orphaned | slug pages render from static seo-templates |
| app/api/templates/analytics/route.ts | Template usage analytics | active | analytics/page.tsx:69 |
| app/api/templates/submit/route.ts | Submit template for review | active | submit/page.tsx:142 |
| app/api/usage/route.ts | Preview-store usage stats dump | orphaned | zero fetchers |
| app/api/version/route.ts | Deploy-freshness commit SHA (#261) | active | 2 refs + external monitors (field stale for CLI deploys — probe behavior) |
| app/api/webhooks/ainative/route.ts | AINative Cloud deploy-status webhook (no signature check) | dormant | middleware 401s cookie-less external POSTs |
| app/api/webhooks/netlify/route.ts | Netlify deploy-status webhook | dormant | same middleware gate; URL never registered |
| app/api/webhooks/railway/route.ts | Railway deploy-status webhook | dormant | same |
| app/api/webhooks/vercel/route.ts | Vercel webhook WITH HMAC verify | dormant | equally unreachable; secret absent → verify always false |
| app/api/workspaces/route.ts | List/create AINative workspaces | active | workspace-switcher.tsx:62,110 |
| app/api/zerodb/[...path]/route.ts | US-057 authenticated ZeroDB CRUD proxy (442 lines, Upstash rate-limited, parallel verifyJWT) | orphaned | only referenced from unimported schema-prompt-enhancer prompt text; live apps use /api/db |
| app/api/zerodb/schema/[tableName]/route.ts | US-053 schema introspection w/ Redis cache | orphaned | zero callers; dead verifyJWT chain |

### 2.2 `app/**` pages (64)

| file | purpose | status | evidence |
|---|---|---|---|
| app/(auth)/actions.ts | Sign-in/up server actions (zod, 12-char policy) | active | auth-form.tsx; UNUSED export guestSignInAction |
| app/(auth)/auth.config.ts | Edge-safe NextAuth base config | active | imported by auth.ts |
| app/(auth)/auth.ts | NextAuth setup: credentials/guest/AINative, workspace resolution, token refresh | active | 55 importers |
| app/(auth)/login/page.tsx | /login — AuthForm + AINative OAuth button | active | middleware redirect target |
| app/(auth)/register/page.tsx | /register signup | active | linked from nav; in sitemap |
| app/about/page.tsx | /about SSR founder story + JSON-LD | active | header/menu/Landing links; allowlisted (#61) |
| app/account/page.tsx | Redirect → /build?screen=account (#83) | active | middleware exact allowlist |
| app/admin/errors/page.tsx | Admin error-log dashboard | active | linked from user-nav admin section |
| app/admin/template-submissions/page.tsx | Admin review queue for templates | dormant | zero inbound links — direct-URL only |
| app/ai-cofounder/page.tsx | SEO/AEO "AI co-founder" landing (#216) | active | sitemap + interlinks |
| app/ai-company/page.tsx | SEO/AEO "AI builds AND runs" landing | active | sitemap + links |
| app/autonomous-company-builder/page.tsx | SEO/AEO landing w/ FAQ JSON-LD | active | sitemap + links |
| app/best/[category]/page.tsx | "Best AI app builders" ranked-list SEO pages | active | sitemap (#44); no internal links — search/ads only |
| app/billing/page.tsx | Redirect → /build?screen=account (#76) | active | allowlisted |
| app/build/page.tsx | /build front door → BuildApp + JSON-LD | active | allowlisted; sitemap priority 1 |
| app/build/[slug]/page.tsx | Shareable company URL; wildcard-host target (#207) | active | middleware rewrites {slug}.ainative.studio here |
| app/capabilities/page.tsx | "What can I build" catalog (#313/#316) | active | allowlisted — but zero internal links AND absent from sitemap |
| app/chats/page.tsx | Legacy chat list | active | chat-selector links; auth-gated |
| app/chats/[chatId]/page.tsx | Chat detail page | active | linked from list/selector |
| app/chats/loading.tsx | Skeleton for /chats | active | Next.js convention |
| app/compare/page.tsx | Competitor comparison hub | active | linked from about/pricing; allowlisted |
| app/compare/[competitor]/page.tsx | "X alternative" AEO pages (5 competitors) | active | sitemap |
| app/context-budget-demo/page.tsx | Context Budget Manager demo (fake session) | orphaned | zero links; auth-gated; only mount of the budget UI |
| app/demo/page.tsx | Early LLAMA preview gallery (hardcoded ids) | orphaned | zero links; ids likely stale |
| app/deployments/page.tsx | Deployments dashboard | active | app-header link; protectedPaths |
| app/design-tokens/page.tsx | Design-token management UI | active | user-nav link |
| app/docs/components/page.tsx | 733-line component docs page | dormant | in sitemap but NOT allowlisted → crawlers 307 to /login; zero internal links |
| app/error.tsx | Segment error boundary | active | convention |
| app/global-error.tsx | Root error boundary | active | convention |
| app/globals.css | Tailwind v4 theme, brand colors | active | layout import |
| app/guides/page.tsx | SEO guides hub | active | header link; sitemap; allowlisted |
| app/guides/[slug]/page.tsx | Statically pre-rendered guides + ImStuck (#321) | active | generateStaticParams; sitemap |
| app/health/live/route.ts | Dependency-free liveness probe | active | Railway healthcheck path |
| app/help/page.tsx | AI Help Center + FAQ JSON-LD (#60) | active | header + AccountMenu links |
| app/help/HelpAskBox.tsx | Client island → /api/build/help | active | help page import |
| app/insights/page.tsx | RLHF insights dashboard | active | user-nav link; auth-gated |
| app/layout.tsx | Root layout: fonts, providers, GA + Meta Pixel | active | wraps every route |
| app/loading.tsx | Root spinner | active | convention |
| app/modernist.css | 1,356-line Modernist design system (.modernist scope) | active | layout + test harnesses |
| app/opengraph-image.tsx | Edge OG image root | active | convention |
| app/page.tsx | Root / IS the builder (BuildApp) (#207) | active | root route; anonymous allowed |
| app/preview/[id]/page.tsx | Thin iframe page for /api/preview/{id} | active | allowlisted; preview-panel builds URLs |
| app/pricing/page.tsx | Public SSR pricing + JSON-LD | active | header link; allowlisted (#76) |
| app/profile/page.tsx | Redirect → /build?screen=account (#83) | active | allowlisted |
| app/projects/page.tsx | Workspace-scoped generated-apps list | dormant | zero inbound links — superseded by /build?screen=companies |
| app/projects/projects-client.tsx | Client project list + tier banner (#6680) | dormant | only importer is unlinked page |
| app/refer/page.tsx | Redirect → /build?screen=refer (#59/#83) | active | allowlisted |
| app/settings/page.tsx | Redirect → /build?screen=account (#83) | active | exact-path allowlist |
| app/settings/credentials/page.tsx | BYO credentials CRUD + connectivity test | active | user-nav link |
| app/settings/rules/page.tsx | Enforcement-rules UI over /api/rules | dormant | zero inbound links; /settings redirects away — undiscoverable |
| app/showcase/page.tsx | Showcase gallery SSR | active | sitemap 0.95; e2e specs |
| app/showcase/[slug]/page.tsx | Showcase detail + per-entry OG | active | sitemap; card links |
| app/showcase/showcase-client.tsx | Client gallery preview builder | active | showcase page import |
| app/showcase/opengraph-image.tsx | Edge OG for /showcase | active | convention |
| app/sitemap.ts | Sitemap generator | active | served at /sitemap.xml; BUG: advertises 3 auth-gated URLs, omits /capabilities |
| app/storybook/page.tsx | 470-line hand-rolled storybook | orphaned | zero links; auth-gated |
| app/templates/page.tsx | Template gallery w/ filters | active | header + mobile-menu links |
| app/templates/[slug]/page.tsx | Per-template SEO landings | active | sitemap |
| app/templates/analytics/page.tsx | Template analytics dashboard | dormant | in sitemap but middleware keeps it gated; zero UI links |
| app/templates/submit/page.tsx | 4-step community template wizard | active | linked twice from templates page |
| app/templates/loading.tsx | Skeleton | active | convention |
| app/test-components/page.tsx | Component-library smoke page | test-only | allowlisted solely for Playwright (#292) |
| app/test-components/domain-modal/page.tsx | DomainModal harness w/ ?authed=1 fake session | test-only | e2e/domain-modal-*.spec.ts |
| app/test-components/sandpack-preview/page.tsx | SandpackPreview 3-file harness (#291) | test-only | e2e/sandpack-multifile.spec.ts |

### 2.3 `components/**` (167)

| file | purpose | status | evidence |
|---|---|---|---|
| a2ui/index.tsx | A2UI barrel | dormant | only preview-panel behind default-off toggle |
| a2ui/A2UIPreview.tsx | Renders agent-pushed component trees | dormant | via dormant barrel |
| a2ui/AgentConnection.tsx | WS client + protocol hook | dormant | dormant module |
| a2ui/ComponentMapper.tsx | A2UI JSON → shadcn mapping | dormant | dormant module |
| a2ui/README.md | A2UI protocol docs | dormant | docs for dormant module |
| admin/template-review-modal.tsx | Approve/reject submissions dialog | active | admin page |
| ai-elements/actions.tsx | Message action row | orphaned | zero importers |
| ai-elements/branch.tsx | Message-branch switcher | orphaned | zero importers |
| ai-elements/code-block.tsx | Prism code block | orphaned | only orphaned tool.tsx |
| ai-elements/conversation.tsx | Auto-scroll conversation container | active | chat-messages → /chats |
| ai-elements/image.tsx | Generated-image renderer | orphaned | zero importers |
| ai-elements/inline-citation.tsx | Citation badge + carousel | orphaned | zero importers; sole consumer of ui/carousel + hover-card |
| ai-elements/loader.tsx | Streaming loader | active | chat-messages |
| ai-elements/message.tsx | Message bubble | active | chat-messages |
| ai-elements/prompt-input.tsx | Composable prompt input | active | chat-input + chat-detail-client |
| ai-elements/reasoning.tsx | Collapsible thinking block | orphaned | zero importers |
| ai-elements/response.tsx | Streamdown markdown renderer | orphaned | only orphaned reasoning.tsx |
| ai-elements/source.tsx | Sources list | orphaned | zero importers |
| ai-elements/suggestion.tsx | Suggestion chips | active | chat-input |
| ai-elements/task.tsx | Agent-task list item | orphaned | zero importers — natural plan/agent-turn surface, unwired |
| ai-elements/tool.tsx | Tool-call renderer (MCP-shaped) | orphaned | zero importers — ready-made tool-call viz |
| ai-elements/web-preview.tsx | Browser-frame preview shell | active | preview-panel |
| aikit/CodeBlock.tsx | @ainative/ai-kit re-export | orphaned | zero importers |
| aikit/StreamingIndicator.tsx | ai-kit re-export | orphaned | zero importers |
| aikit/StreamingMessage.tsx | ai-kit re-export | test-only | only aikit-integration.test.ts |
| aikit/types/index.ts | Local AIKit types | orphaned | zero importers |
| ainative-oauth-button.tsx | Sign-in-with-AINative button | active | login page |
| analytics/google-analytics.tsx | GA4 loader + trackEvent | active | layout + build funnel screens |
| analytics/meta-pixel.tsx | Meta Pixel + CAPI dedup (#207) | active | layout + build screens (pixel silent until ID set) |
| auth-form.tsx | Email/password form | active | login + register pages |
| build/AccountMenu.tsx | Auth-aware account dropdown (#56) | active | MenuChip + WorkspaceShell |
| build/ArtifactFrame.tsx | Artifact chrome + Regenerate-with-feedback (GR-16 #329) | active | ArtifactRouter — human-review loop |
| build/ArtifactRail.tsx | Artifact drawer (#235) | active | WorkspaceShell |
| build/ArtifactRouter.tsx | View → artifact screen map (#220) | active | Workspace screen |
| build/AutoModePanel.tsx | Bounded autonomous-run control (#58) | active | screens/Live |
| build/BuildApp.tsx | Top-level pivot router (#220) | active | app/page.tsx + app/build/page.tsx |
| build/BuildOverlays.tsx | "Watch Cody build" overlays (#207) | active | WorkspaceShell |
| build/CodyFeed.tsx | Cody commentary + nudges (#220/#221) | active | Workspace |
| build/CodyNudge.tsx | Nudge card (#221) | active | CodyFeed |
| build/DangerZone.tsx | Pause/offline/delete w/ typed confirm (#57) | active | Account screen |
| build/DecisionModal.tsx | Mid-build product question, resumes autoplay (#207) | active | WorkspaceShell — plan/decision turns |
| build/DocumentsPanel.tsx | Documents + Reports tabs (#64) | active | Live |
| build/DomainModal.tsx | Domain purchase modal (#207 FIX-3) | active | Live + Playwright harness |
| build/EcosystemRunwayNote.tsx | GR-15 composition bonus note (#324) | active | Workspace |
| build/FeedbackPulse.tsx | One-line RLHF rating strip (#332 DATA-1) | active | Preview.tsx + Live |
| build/FirstRunGuide.tsx | First-build coach strip (#319) | active | Workspace |
| build/LiveProof.tsx | Real loop-numbers proof strip (#222) | active | Fork |
| build/LiveTicker.tsx | Live agent-activity ticker (#207) | active | Fork |
| build/MediaPanel.tsx | Auto-media scheduling (#54) | active | Live |
| build/MenuChip.tsx | Account chip outside shell | active | Fork/Live/MyCompanies |
| build/OnboardingVideo.tsx | Onboarding video slot (#51) | active | Live (src still placeholder) |
| build/PoweringThis.tsx | Primitive chips + tooltips (#221/#288/#66) | active | Workspace |
| build/ProposalGate.tsx | Pay-gate proposal w/ real preview (#68) | active | Pricing |
| build/SettingsForm.tsx | Founder profile editor (#57) | active | Account |
| build/SystemSaving.tsx | SaaS-comparable savings line | active | Live |
| build/SystemStatusBadge.tsx | Live vs Planned pill (#67) | active | ProposalGate + Live |
| build/TasksPanel.tsx | Real Tasks/Backlog, swarm task_ids (#55) | active | Live |
| build/TerminalRibbon.tsx | Infra-narration strip (#207) | active | WorkspaceShell |
| build/ValueStrip.tsx | 3-step value strip (#65) | active | Fork |
| build/VersionsPanel.tsx | Versions + health-verified rollback (#62) | active | Live |
| build/WebsitePanel.tsx | Redeploy + masked secrets (#63) | active | Live |
| build/WorkspaceShell.tsx | Workspace chrome (#220) | active | Workspace |
| build/artifacts/Conflict.tsx | Dependency conflict w/ real traced impact | active | ArtifactRouter |
| build/artifacts/Graph.tsx | Real artifact dependency graph (#225/#234) | active | ArtifactRouter |
| build/artifacts/Pipeline.tsx | Sales-pipeline kanban — HARDCODED demo deals | active | ArtifactRouter (static data gap) |
| build/artifacts/Preview.tsx | REAL generated app preview via useRealPreview (#223) | active | ArtifactRouter; mounts FeedbackPulse |
| build/artifacts/RescopeIntent.tsx | Re-scope lead-in (#286) | active | ArtifactRouter |
| build/artifacts/Swarm.tsx | Real swarm attempt + honest fallback (#223/#232) | active | ArtifactRouter |
| build/artifacts/Wedge.tsx | Wedge interrupt (static options) (#224) | active | ArtifactRouter |
| build/artifacts/app-artifacts.tsx | App-track real artifact bodies | active | ArtifactRouter |
| build/artifacts/company-artifacts.tsx | Company-track real artifact bodies | active | ArtifactRouter |
| build/artifacts/gen-helpers.tsx | Shared useGen + presentational bits | active | both artifact files |
| build/screens/Account.tsx | Account screen (#227/#251/#253/#50) | active | BuildApp |
| build/screens/Auth.tsx | Auth screens + migration + conversion events (#227) | active | BuildApp |
| build/screens/BuildStart.tsx | Surprise-me vs own idea | active | BuildApp |
| build/screens/Fork.tsx | Track picker (#222/#65) | active | BuildApp |
| build/screens/Intake.tsx | Idea capture + limit gating (#222) | active | BuildApp |
| build/screens/Landing.tsx | Marketing front door scrollytelling | active | BuildApp (cold visitors) |
| build/screens/Live.tsx | Live operating dashboard (847 lines) (#226) | active | BuildApp |
| build/screens/MyCompanies.tsx | Company index w/ ownership handles (#253) | active | BuildApp |
| build/screens/Pricing.tsx | Pay gate + ProposalGate (#226) | active | BuildApp |
| build/screens/ReferEarn.tsx | Refer & Earn (#59) | active | BuildApp |
| build/screens/Start.tsx | Create vs grow choice | active | BuildApp |
| build/screens/Workspace.tsx | Workspace router (#220) | active | BuildApp |
| chat/build-progress.tsx | Task-list build progress | active | chat-messages |
| chat/chat-input.tsx | Legacy composer | active | chat-detail-client |
| chat/chat-messages.tsx | Legacy messages + RLHF thumbs + file tree | active | chat-detail-client |
| chat/code-viewer.tsx | Full-screen file/code viewer | active | preview-panel |
| chat/file-tree.tsx | File tree w/ per-file status | active | chat-messages + file-parser |
| chat/preview-panel.tsx | Legacy preview panel (+ dormant A2UI toggle) | active | chat-detail-client |
| chat/sandpack-preview.tsx | Sandpack multi-file preview + jsx-fixer pipeline (#291) | active | Preview.tsx, preview-panel, test harness |
| chats/chat-detail-client.tsx | /chats/[chatId] shell | active | page import |
| chats/chats-client.tsx | Chats index list | active | chats page |
| command-palette.tsx | Cmd+K palette (#17) | active | provider → layout |
| command-progress-tracker.tsx | Execution tracker w/ evidence attachments | active | command-palette |
| command-variable-prompt.tsx | Variable-input dialog | active | command-palette |
| context-budget/index.ts | Budget barrel | active | demo route only |
| context-budget/budget-dashboard.tsx | Token-budget dashboard | active | demo route only |
| context-budget/budget-breakdown.tsx | Pie chart | active | demo only |
| context-budget/budget-meter.tsx | Usage meter | active | demo only |
| context-budget/context-items-list.tsx | Items list + unload | active | demo only |
| context-budget/optimization-suggestions.tsx | Savings suggestions | active | demo only |
| deploy-dialog.tsx | Deploy generated app dialog | active | preview-panel |
| design-tokens/preview.tsx | Token set preview | active | design-tokens page |
| design-tokens/upload-dialog.tsx | Token upload/parse | active | design-tokens page |
| design-tokens/version-history.tsx | Version history dialog | active | design-tokens page |
| enforcement/enforcement-dashboard.tsx | Rule-compliance dashboard | active | settings/rules page (itself dormant) |
| enforcement/rule-violation-list.tsx | Violations list | active | enforcement-dashboard |
| env-setup.tsx | Dev missing-env screen | active | app/page.tsx (dev only) |
| evidence/evidence-gallery.tsx | Test-run/build/coverage/deploy evidence gallery | active | app/evidence page (page unlinked) |
| evidence/evidence-timeline.tsx | Evidence timeline | active | app/evidence page |
| export-button.tsx | Download generation | active | preview-panel |
| feedback-dialog.tsx | Star+comment RLHF dialog | orphaned | only orphaned home-client imports it |
| generated-landing.tsx | LLAMA-generated sample page in repo | orphaned | zero importers |
| help/ImStuck.tsx | Stuck-box → /api/help/stuck (#321) | active | help + guides pages |
| home/home-client.tsx | Legacy 1,003-line chat-first home | orphaned | zero importers since #207 pivot |
| message-renderer.tsx | Legacy message content renderer | active | chat-messages |
| providers/command-palette-provider.tsx | Global palette mount | active | layout |
| providers/session-provider.tsx | NextAuth SessionProvider | active | layout |
| providers/swr-provider.tsx | Global SWRConfig | active | layout |
| shared-components.tsx | Fallback component map | active | chat-messages |
| shared/app-header.tsx | Site-wide header | active | 23 importers |
| shared/bottom-toolbar.tsx | Mobile panel switcher | active | chat-detail-client |
| shared/chat-menu.tsx | Per-chat dropdown (superseded) | orphaned | zero importers; fetches nonexistent /api/chat/fork,delete |
| shared/chat-selector.tsx | Header chat dropdown | active | app-header + mobile-menu |
| shared/mobile-menu.tsx | Mobile nav | active | app-header |
| shared/resizable-layout.tsx | Two-panel resizable layout | active | chat-detail-client |
| skills/skill-browser.tsx | Skill marketplace browser | orphaned | zero importers; no /skills route |
| skills/skill-editor.tsx | Skill editor form | orphaned | zero importers |
| templates/customize-dialog.tsx | Template customization | active | templates page |
| templates/preview-modal.tsx | Template preview modal | active | templates page |
| templates/template-card.tsx | Gallery card | active | templates page |
| templates/template-filters.tsx | Search/filters | active | templates page |
| ui/accordion.tsx | shadcn accordion | active | docs/storybook/test-components |
| ui/alert.tsx | shadcn alert | active | progress-tracker + enforcement |
| ui/avatar.tsx | shadcn avatar | active | user-nav et al. |
| ui/badge.tsx | shadcn badge | active | 42 importers |
| ui/button.tsx | shadcn button | active | 73 importers (most-imported) |
| ui/card.tsx | shadcn card | active | 32 importers |
| ui/carousel.tsx | Embla carousel | orphaned | only orphaned inline-citation |
| ui/checkbox.tsx | shadcn checkbox | active | 9 importers |
| ui/collapsible.tsx | shadcn collapsible | active | admin/errors + web-preview |
| ui/command.tsx | cmdk menu | active | command-palette |
| ui/dialog.tsx | shadcn dialog | active | 20 importers |
| ui/dropdown-menu.tsx | shadcn dropdown | active | user-nav, chat-selector, workspace-switcher |
| ui/hover-card.tsx | shadcn hover-card | orphaned | only orphaned inline-citation |
| ui/icons.tsx | SVG icons (Vercel/GitHub) | active | mobile-menu (VercelIcon unused) |
| ui/input.tsx | shadcn input | active | 19 importers |
| ui/label.tsx | shadcn label | active | 18 importers |
| ui/popover.tsx | shadcn popover | active | upload-dialog |
| ui/progress.tsx | shadcn progress | active | 7 importers |
| ui/radio-group.tsx | shadcn radio-group | active | docs/storybook/test-components |
| ui/scroll-area.tsx | shadcn scroll-area | active | 16 importers |
| ui/select.tsx | shadcn select | active | 22 importers |
| ui/separator.tsx | shadcn separator | active | 13 importers |
| ui/sheet.tsx | shadcn side-sheet | orphaned | zero importers |
| ui/table.tsx | shadcn table | active | 11 importers |
| ui/tabs.tsx | shadcn tabs | active | 12 importers |
| ui/textarea.tsx | shadcn textarea | active | 8 importers |
| ui/toast.tsx | shadcn toast primitives | active | toaster + use-toast |
| ui/toaster.tsx | Global toast renderer | active | layout |
| ui/tooltip.tsx | shadcn tooltip | active | web-preview |
| ui/use-toast.ts | Toast state store | active | 11 importers |
| upgrade-banner.tsx | Token-limit upgrade banner | orphaned | only orphaned home-client |
| user-nav-client.tsx | SSR-safe UserNav wrapper | active | app-header |
| user-nav.tsx | User avatar dropdown | active | via user-nav-client |
| workspace-switcher.tsx | Workspace switcher | active | app-header + projects-client |

### 2.4 `lib/build/**` (70)

| file | purpose | status | evidence |
|---|---|---|---|
| account-session.ts | Guest-vs-auth detection (#50) | active | AccountMenu, Account, ReferEarn |
| acts.ts | Five act labels | active | WorkspaceShell |
| app-data-token.ts | HMAC per-app data token — IDOR fix (#331) | active | db route + preview route |
| app-registry.ts | slug → chatId/owner/railwayServiceId registry | active | 16 API routes + [slug] page + middleware |
| artifact-edit.ts | Review/edit/regenerate w/ feedback (GR-16) | active | artifact route + ArtifactFrame |
| artifact-graph.ts | Real artifact dependency graph (#234) | active | Rail/Conflict/Graph/RescopeIntent |
| artifact-prompts.ts | Strict-JSON artifact prompts (#207) | active | artifact route + useAutoplay |
| attribution.ts | gclid/utm/fbc/referral cookies (90d) | active | BuildApp, Auth, build-context |
| auto-mode.ts | Bounded run windows + ZeroDB run store (#58) | active | auto-mode + nightly-loop routes, panel, hook |
| auto-run-activity.ts | Run-activity ring buffer (#340) | active | routes + Live + hooks |
| autonomous-loop.ts | Briefing → swarm dispatch loop (Option B) | active | auto-mode + nightly-loop; NO in-repo cron — external trigger required |
| build-credits.ts | Credit metering, fail-open | active | credits route |
| business-systems.ts | Idea-driven systems → primitives (#233/#288) | active | systems route, Live, proposal |
| capabilities.ts | Plain-English capabilities catalog (#313) | active | help route, capabilities page, primitive-catalog |
| chat-store.ts | Cody chat persistence + canonical {owner}::{company} scope key (#52) | active | 15 routes + all stores |
| claude-completion.ts | Bedrock-else-Anthropic resolver (Config C) | active | 7 routes |
| coding-standards.ts | TDD-80%/DoD standards injected into artifacts + swarm (#71) | active | swarm route, artifact-prompts, app-artifacts |
| company-export.ts | Full data export (#63.C) | active | export route |
| completeness-gate.ts | findMissingLocalImports truncation detector (#333) | active | via ready-gate → register-app |
| content-language.ts | Content-language catalog (#57) | active | artifact/nightshift routes |
| conversions.ts | Server-side Google Ads conversions (gclid) | active | lead, register, verify routes |
| danger-zone.ts | Pause/offline/delete logic (#57) | active | danger route |
| deck-model.ts | Pitch-deck composition (#69) | active | deck route + pptx |
| deck-pptx.ts | Hand-rolled OOXML .pptx serializer | active | deck route |
| decomposition.ts | Single-large-file → multi-file split pass (#293 P5) | active | chat-ws:1265 |
| deploy.ts | Wildcard host resolution + deployPersistent/Railway (#243) | active | provision/register-app/verify + middleware |
| document-prompts.ts | Durable doc prompts + daily-report builder (#64) | active | deck/documents/nightly-loop |
| document-store.ts | ZeroDB build_documents store (#64) | active | same routes |
| ecosystem-bonus.ts | Composition free-build bonus (GR-15) | active | credits route + build-credits |
| feedback-capture.ts | Once-per-generation RLHF logic (#332) | active | FeedbackPulse |
| first-run.ts | Coach-strip show/dismiss (#319) | active | FirstRunGuide |
| flatten-multifile.ts | Multi-file → one Babel module (#308) | active | preview route + ready-gate |
| front-door-value.ts | Value-prop copy + liveStatusLine (#65) | active | ValueStrip, Fork, Live |
| guest-migration.ts | Guest → account migration client (#49) | active | Auth, MyCompanies |
| help-faq.ts | FAQ KB + retriever (#60) | active | help route, help page, stuck-search |
| instant-db.ts | One-POST per-company ZeroDB project+key (#243/#250) | active | provision route:149 + app-registry |
| learning.ts | Idea→app→conversion capture (#270) | active | 4 routes |
| live-vs-planned.ts | Status-badge logic (#67) | active | ProposalGate, badge, Live |
| loop-enrollment.ts | builder_loop_enrollments store | active | 5 routes + danger-zone |
| mcp-provision.ts | Cody provisions data via real ZeroDB MCP tools (#73 P1) | dormant | called from provision:112 but inert without ENABLE_MCP_PROVISION + MCP key; silent REST fallback |
| media-routine.ts | Nightly media-routine executor (#54) | dormant | gated on BUILD_MEDIA_ENABLED (absent) — returns {generated:0} |
| media-schedule.ts | Media store + generation calls (#54) | active | media routes; generation half gated behind BUILD_MEDIA_ENABLED |
| media-upload.ts | Upload validation/shaping (#323) | active | upload route + MediaPanel |
| meta-capi.ts | Server-side Meta CAPI mirror | dormant | full no-op without META_CAPI_ACCESS_TOKEN (pending) |
| model-select.ts | Complexity → Sonnet/Opus Bedrock profile (#306) | active | chat-ws:356 |
| multifile-emphasis.ts | Multi-file prompt block (#291) | active | chat-ws |
| obedience-gate.ts | Flags missing /api/db persistence + non-AIKit patterns → re-prompt (#297) | active | chat-ws |
| pending-build.ts | Pending build across email-verify round-trip | active | build-context |
| preview-engine.ts | shouldUseSandpack routing (#291) | active | chat-ws + Preview.tsx |
| pricing-tiers.ts | Pricing page source of truth (#76) | active | pricing page |
| primitive-catalog.ts | Machine-readable primitive catalog + selectPrimitives (#288) | active | 5 routes + components + mcp-provision + mcp client |
| primitive-graph.ts | Archetype → primitives/AIKit knowledge graph (#83 P7c) | active | via primitive-catalog → chat-ws |
| primitives.ts | Per-view primitive map (#218/#220) | active | CodyFeed/Nudge/PoweringThis/context |
| profile.ts | Settings validation + core persistence (#57) | active | profile + artifact routes |
| proposal.ts | Pay-gate proposal model (#68) | active | ProposalGate |
| rag-context.ts | ZeroMemory recall → PRIOR BUILD LEARNINGS block (#81 P7a) | active | chat-ws:361 |
| railway-deploy.ts | Railway GraphQL provisioner + ops (1,049 lines) (#243) | active | 4 routes + deploy + version-store; creation env-gated (RAILWAY_DEPLOY_ENABLED) |
| ready-gate.ts | Pre-deploy parse + completeness gate — 422 + retry (#77/#333) | active | register-app route |
| referral.ts | Referral ledger (#59) | active | referral + verify routes, ReferEarn |
| state.ts | Pivot state machine (#220) | active | 15+ components + context |
| task-store.ts | ZeroDB build_tasks lifecycle (#55) | active | swarm + tasks routes, TasksPanel |
| tier-models.ts | Plan → Claude model map (#207) | active | artifact + ask routes |
| titles.ts | Artifact title map | active | router/overlays/graph |
| useAutoRun.ts | 15s auto-mode poll hook (#340) | active | Live |
| useAutoplay.ts | Autoplay engine w/ pause-for-decision (#207 Act 2) | active | build-context |
| useLiveProof.ts | Real intelligence numbers hook | active | LiveProof/Ticker/Live |
| useRealPreview.ts | Nav-surviving generation state (#207 B1) | active | Preview.tsx |
| value-moment.ts | Never-paywall-before-preview sequencing (GR-01/02/11) | active | 4 screens |
| version-store.ts | ZeroDB build_versions index (#62) | active | versions route |
| zeropipeline.ts | Real ZeroPipeline CRM provisioning (idempotent) (#243.C) | active | provision route:38 (JWT-only, signed-in founders) |

### 2.5 `lib/agent/**` (16)

| file | purpose | status | evidence |
|---|---|---|---|
| agent-profiles.ts | Parses ~/.claude/agents profiles into subagent prompts | dormant | only subagents.ts, behind USE_SUBAGENTS=false; homedir-read unlikely in Railway |
| agent-runtime.ts | Runtime selection claude-vs-cody, flags (#79) | dormant | only claude-agent.ts; USE_CLAUDE_AGENT/AGENT_RUNTIME unset |
| chunk-merger.ts | Merge phase 1/2/3 chunks | active | chat-ws:679 — wired but rarely fires (complexity under-count) |
| chunk-planner.ts | Multi-phase chunk plan from PRD | active | chat-ws:652 + multi-pass-generator |
| claude-agent.ts | Headless CLI agent (stream-json, worktrees, SSE events) | dormant | skipped in prod: bedrockPrimary (CODY_USE_BEDROCK=1) bypasses; cody-cli #239 cited |
| complexity-analyzer.ts | Complexity scoring (pages/features/tokens) | active | chat-ws:280 every generation; known under-counter |
| component-generation-tool.ts | Anthropic tool-use schema + extractComponentCode | active | chat-ws, multi-pass, subagents |
| generation-mode.ts | USE_SUBAGENTS selector (#11) | active | selector runs; guarded branch off |
| metrics.ts | Subagent metrics collector (#9) | dormant | only subagents.ts (off) |
| multi-pass-generator.ts | Execute chunk plan w/ per-chunk validation | active | chat-ws requiresChunking branch (rarely fires) |
| subagents.ts | Orchestrator → design/code/VALIDATION subagents (US-025) | dormant | chat-ws:714 behind USE_SUBAGENTS=false; needs ANTHROPIC_API_KEY |
| trajectory-capture.ts | Full trajectories + install/build/run auto-verify rewards | dormant | only claude-agent (off) + offline scripts |
| trajectory-store.ts | Persist labeled trajectories → cody_trajectories | dormant | sole importer claude-agent (off) |
| verify-loop.ts | Build→error→retry verify agent (Bash, $0.75, 6 turns) (#80 P1) | dormant | chat-ws:1171-1178 behind isClaudeAgentFallbackEnabled() = false |
| worktree-manager.ts | Per-session /tmp scaffold workspaces | dormant | behind disabled agent path (chat-ws imports only cleanup) |
| zeromemory.ts | ZeroMemory recall/store of past performance (#43) | active | chat-ws live path + multi-pass + subagents |

### 2.6 `lib/**` misc (75 — catalog delivered through `lib/multi-file-parser.ts`)

| file | purpose | status | evidence |
|---|---|---|---|
| aikit/ai-kit-core-browser-stub.ts | Browser stub for @ainative/ai-kit-core (#6) | active | next.config.ts aliases |
| ainative-file-generator.ts | AX file set (robots/llms.txt/ai-plugin) for generated apps | active | chat-ws + multi-file-parser |
| ainative/active-plan.ts | Paid-plan resolution (#251/#309) | active | auto-mode + ask routes |
| ainative/client.ts | Bearer-JWT fetch wrapper for core | active | plan.ts, profile.ts |
| ainative/link-project.ts | Create core Project per generated app | active | home-client (which is orphaned — effectively at risk) |
| ainative/plan.ts | Tier awareness (Hobbyist trial, slots) | active | 5 routes |
| ainative/projects.ts | Core project API client | active | projects route + plan |
| ainative/types.ts | Core Pydantic shape mirrors | active | 3 routes + profile |
| ainative/workspaces.ts | Workspace API client | active | workspaces route + plan |
| auth-jwt.ts | Local JWT sign/verify + sessions (parallel stack) | active | only the orphaned parallel routes import it — stack is effectively dead code |
| auth-middleware.ts | withAuth JWT wrapper | active | only orphaned chats-v2 routes |
| auth.ts | NextAuth re-export | active | admin, templates, commands routes |
| auth/ainative-oauth.ts | OAuth2.1 + PKCE helpers | active | authorize/callback + login |
| auth/oauth-error-messages.ts | Friendly OAuth error map (#294) | active | login page |
| auth/session.ts | Cookie session reader | active | deploy/export/credentials routes |
| auth/tokenRefresh.ts | Proactive token refresh | active | auth.ts |
| bedrock-client.ts | Bearer-token Bedrock client (Config C) | active | chat-ws + claude-completion |
| client/command-client.ts | Browser fetch wrapper for /api/commands | active | command-palette |
| code-validator.ts | Babel-parse validation + auto-fix (method-chain, dup-decl) | active | chat-ws, preview, sandpack, ready-gate; 10 test files |
| component-detector.ts | Root-component detection (#82) | active | preview route + code-validator |
| component-verifier.ts | Whitelist component verify/replace | active | chat + chat-ws |
| config/model-validator.ts | Startup model-config validation (#5) | active | chat-ws |
| constants.ts | Shared constants + env flags | active | middleware, auth, credits, more |
| data/built-in-commands.ts | Built-in palette command defs | dormant | only orphaned seed script + a test |
| data/component-docs.json | Component docs for prompts (US-030) | active | prompt-builder.service → /api/chat |
| data/seo-guides.ts | Guides catalog (#35) | active | sitemap + guides + stuck-search |
| data/seo-templates.ts | Template SEO catalog | active | sitemap + templates/[slug] |
| data/templates/index.ts | Aggregates 5 starter templates | orphaned | zero importers; DB seeding uses separate inline data |
| data/templates/admin-panel.ts | Starter template | orphaned | only orphaned index |
| data/templates/blog-layout.ts | Starter template | orphaned | only orphaned index |
| data/templates/ecommerce-product.ts | Starter template | orphaned | only orphaned index |
| data/templates/landing-page.ts | Starter template | orphaned | only orphaned index |
| data/templates/saas-dashboard.ts | Starter template | orphaned | only orphaned index |
| db/connection.ts | Drizzle + postgres-js singleton | active | db/index, logger, jobs, routes |
| db/index.ts | DB barrel | active | ~20 routes |
| db/migrate.ts | Migration runner | active | npm db:migrate |
| db/migrations/ (11 SQL + meta) | Drizzle migrations | active | migrate.ts + drizzle-kit |
| db/queries.ts | All Drizzle query helpers | active | ~20 routes + auth + services |
| db/schema.ts | Whole builder DB schema | active | 36+ files |
| db/seed-built-in-commands.ts | Seed agent_commands | orphaned | zero importers/scripts; manual step in docs only |
| db/seed-few-shot-examples.ts | Seed few_shot_examples (US-028) | orphaned | zero importers/scripts |
| db/seed-templates.ts | Seed templates table | orphaned | zero importers/scripts |
| db/utils.ts | bcrypt password helpers | active | queries.ts |
| design-tokens/auth-helper.ts | Session→user for token routes | active | all 6 design-token routes |
| design-tokens/parsers.ts | Parse uploaded token files | active | upload route + dialog |
| design-tokens/types.ts | DesignTokens interfaces | active | page + routes + components |
| design-tokens/validators.ts | Token validation | active | upload route + dialog |
| emoticon-blocker.ts | Strip emojis from generated code | active | component-generation-tool → chat-ws |
| entitlements.ts | Per-user-type entitlements | active | chat-llama (itself orphaned — at risk) |
| env-check.ts | Missing env-var report | active | page + env-setup |
| errors.ts | ChatSDKError classes | active | chat-llama (at risk) |
| export/project-exporter.ts | ZIP builder (JSZip) | active | export route |
| file-parser.ts | File tree from Sandpack files | active | chat-messages |
| generation-checkpoint.ts | Checkpoint + degradation ladder (#81) | active | chat-ws; unit-tested |
| generation-persist.ts | Durable ZeroDB persistence on ALL paths (#89) | active | chat-ws |
| generation-retry.ts | Closed retry loop w/ error feedback (#77) | active | chat-ws |
| gradient-blocker.ts | Strip Tailwind gradients | active | chat-ws |
| growth/llm-mention-tracker.ts | AEO brand-mention tracker (#47) | active | npm 'mentions' script (manual CLI) |
| help/stuck-search.ts | Guides+FAQ retrieval (#321) | active | guides page + stuck route |
| icon-system.ts | Icon library mapping | active | mock-data-generator → chat routes |
| jobs/alerting.ts | Error-rate alert rules | active | cron/alerts route (which is itself unreachable — effectively dead) |
| jobs/prompt-rollback.ts | US-017 auto prompt rollback | orphaned | zero importers; no scheduler |
| jobs/quality-alerts.ts | US-018 quality degradation alerts | orphaned | never called |
| jobs/schema-change-detector.ts | US-059 schema-change polling | orphaned | never invoked |
| llama-provider.ts | ai-sdk Llama provider | active | chat-llama (at risk) |
| logger.ts | Pino + error_logs sink | active | 30+ files |
| mcp/ainative-mcp-client.ts | Multi-server MCP Streamable-HTTP client (#73) | dormant | only mcp-provision (flag-off) + 2 tests |
| mcp/design-system-client.ts | Design System MCP client (US-021) | active | design-tokens.service → /api/chat; localhost default degrades gracefully |
| mcp/google-stitch-client.ts | Google Stitch UI-design client | dormant | only manual test script; key empty |
| mcp/zerodb-client.ts | ZeroDB MCP client (US-052) | active | zerodb proxy route + schema.service |
| middleware/error-handler.ts | Error-response shaping | active | admin/errors route |
| middleware/rate-limit.ts | Upstash edge rate limiting | active | middleware.ts; no-ops without Upstash env |
| mock-data-generator.ts | Mock-data templates for prompts | active | chat + chat-ws |
| monitoring.ts | Token/error metrics aggregation | active | health route |
| multi-file-parser.ts | FILE-marker splitting + AX file injection | active | chat-ws (catalog delivery truncated at this entry) |

*(Not tabulated — catalog not delivered: remainder of `lib/` (`preview-store*`, `professional-prompt`, `prompt-builder`, `services/**` incl. fullstack-generator/schema-inference/schema-prompt-enhancer/prompt.service, `sandpack/setup`, `types/`), `contexts/`, `hooks/`. Evidence cells above establish the live ones: `professional-prompt`, `preview-store-v2`, `prompt.service` (via /api/chat), `sandpack/setup`; and the dead pair `fullstack-generator` + `schema-inference`, plus unimported `schema-prompt-enhancer`.)*

---

## 3. Existing machinery relevant to build quality

### 3.1 TDD for generated apps

**What exists:**

- **Live static gates on the codegen path (`/api/chat-ws`):** `lib/code-validator.ts` (Babel parse + auto-fix), `lib/generation-retry.ts` (error-fed retry, capped), `lib/generation-checkpoint.ts` (never render broken code), `lib/build/ready-gate.ts` + `completeness-gate.ts` (pre-deploy parse + truncation/missing-import 422 + retry, #77/#333), `lib/build/obedience-gate.ts` (missing `/api/db` persistence / non-AIKit → re-prompt, #297), `lib/component-verifier.ts`, `gradient-blocker`, `emoticon-blocker`.
- **Run-the-code verification — built, dormant:** `lib/agent/verify-loop.ts` (Read/Write/Edit/Bash repair agent, typecheck/build, $0.75/6 turns) wired at chat-ws:1171–1178 behind `isClaudeAgentFallbackEnabled()`; `lib/agent/trajectory-capture.ts` execution-based auto-verify (install/build/run) rewards → `cody_trajectories` — both behind the disabled agent runtime.
- **Evidence gate — built, unwired:** `app/api/evidence/verify` (test-only) verifies passing test-run/coverage/build evidence before commits; `app/evidence` + `components/evidence/{gallery,timeline}` surface test runs/COVERAGE/builds/deploys but the page is linked from nowhere.
- **Standards without enforcement:** `lib/build/coding-standards.ts` injects mandatory-TDD/80%-coverage DoD into the codingStandards artifact AND swarm dispatch context — stated to agents, never verified on output.
- **Harness pattern:** `app/test-components/sandpack-preview` + `e2e/sandpack-multifile.spec.ts` prove multi-file apps really bundle; `/api/generation/[id]/files` persists multi-file maps so a test harness can rehydrate.

**Honest gap:** nothing on the live path *executes* generated code or any test of it. No tests are ever *generated* for generated apps, no runner exists to execute them, and the two mechanisms that do run code (verify-loop, trajectory-capture) are both flag-off behind the dormant agent runtime. The evidence-verify gate is the natural enforcement seam but is connected to nothing.

### 3.2 Plan / review agent turns

**What exists:**

- **Review turn (implemented, off):** `lib/agent/subagents.ts` — orchestrator → design/code/**validation** subagent pipeline, behind `USE_SUBAGENTS=false` (+ `agent-profiles.ts`, `metrics.ts`).
- **Plan turn (implemented, rarely fires):** `lib/agent/chunk-planner.ts` (explicit multi-phase plan) + `multi-pass-generator.ts` + `chunk-merger.ts` wired un-flagged into chat-ws (lines 652/679) but gated by `complexity-analyzer.ts` `requiresChunking`, which under-counts raw ideas; `lib/build/decomposition.ts` is the live-but-narrower substitute (post-hoc split, #293).
- **Human plan/review turns (live):** `components/build/DecisionModal.tsx` (mid-build product questions that pause autoplay), `ArtifactFrame.tsx` Regenerate-with-feedback (GR-16), `FeedbackPulse` RLHF ratings.
- **Real multi-agent orchestration (live-ish):** `/api/build/swarm` pre-wired to the platform agent-swarm with honest fallback (blocked solely by core#6422); `/api/build/nightly-loop` + `auto-mode` + `task-store` form the brief→dispatch→task-lifecycle→report loop (needs external cron); `lib/build/autonomous-loop.ts`.
- **Governance seam:** `/api/rules/validate` + `/api/rules/auto-fix` — agent-action rules engine with test-run/build/deploy action types — only exercised from the unreachable settings page.
- **Display components ready:** `ai-elements/task.tsx` and `tool.tsx` (orphaned) are ready-made plan-step/tool-call renderers.
- **Prompt experimentation:** `/api/prompts` A/B versioning — service live only in legacy `/api/chat` via `getActivePromptVersion`, NOT chat-ws.

**Honest gap:** the primary chat-ws path has zero dedicated plan or review model turns — it is single-shot + static-gate retries. Every implemented plan/review mechanism is either flag-off (subagents, verify-loop), rarely-triggered (chunk plan), blocked upstream (swarm/core#6422), or unreachable UI (rules engine). Prompt A/B can't touch the main pipeline.

### 3.3 MCP / real-data provisioning

**What exists (live):**

- `lib/build/instant-db.ts` — one-POST per-company ZeroDB project+key, filed into the Builder workspace (#243/#250), from `/api/build/provision` (sk_ permanent / tmp_ 72h + claim token).
- `lib/build/app-data-token.ts` + `/api/db/[table]` — HMAC-scoped per-app data plane; preview route injects a fetch shim so generated code needs no changes (#331); `obedience-gate` enforces generated apps actually use it.
- `lib/build/zeropipeline.ts` — real ZeroPipeline CRM pipeline provisioned per company (idempotent, founder JWT).
- `lib/build/primitive-catalog.ts` + `primitive-graph.ts` + `capabilities.ts` — idea→primitive selection feeding prompts and the Live dashboard.
- `lib/mcp/zerodb-client.ts` (schema introspection, live via schema.service) and `design-system-client.ts` (live via /api/chat); `app/settings/credentials` per-credential connectivity tests.

**What exists (built, off):**

- `lib/build/mcp-provision.ts` + `lib/mcp/ainative-mcp-client.ts` (#73) — Cody agentically calling `zerodb_create_project`/`zerodb_create_table` MCP tools; called at provision:112, inert without `ENABLE_MCP_PROVISION=1` + `AINATIVE_MCP_API_KEY`; falls back silently to REST.
- `app/api/fullstack/provision` + `fullstack-generator.service` + `schema-inference.service` (#36) — prompt→inferred data model→auto-provisioned tables→endpoints/auth scaffold/TS client — fully orphaned.
- Superseded/dead: `/api/zerodb/[...path]` (442-line rate-limited CRUD proxy) + schema route + `schema-prompt-enhancer` — a complete second data plane to retire. `google-stitch-client` dormant.

**Honest gap:** provisioning today is *generic* (project + key + one default pipeline) — the schema is never derived from the idea. The two pieces that close that (MCP tool-driven table creation; prompt→schema inference) both exist and are unwired: one is a flag+key away, the other needs wiring from `/build` provisioning into the generation prompt. `artifacts/Pipeline.tsx` still shows hardcoded demo deals despite `zeropipeline.ts` provisioning a real pipeline — the read-back wire is missing.

---

## 4. Test-coverage gaps by product area

Repo uses **Vitest** (`npx jest` silently parses nothing — do not trust "jest passed" claims). ~110 unit test files (`__tests__/`), 64 Playwright specs (`e2e/`).

**Well covered:** code-validator (5 dedicated files incl. method-chain/duplicates/multifile), app-registry (5 files: core/railway/byo-domain/claim/migrate), ready/parse/completeness gates (#77/#79/#333), primitive catalog + MCP unit tests, build credits + ecosystem bonus, railway-deploy + custom domains, generation checkpoint/persist/retry, guest migration, sitemap/SEO catalogs, `/build` funnel e2e (core-flow, pay-gate, pricing-billing, refer-earn, versions-rollback, tasks-backlog, media-panel, documents-library, auto-mode, domain modals), preview rendering sweeps.

**Gaps:**

| Product area | Gap |
|---|---|
| `/api/chat-ws` pipeline | The 1,677-line route has no direct unit tests — only sub-modules and flaky browser sweeps cover it. Obedience-gate/decomposition/model-select interplay untested end-to-end. Memory: code-analysis beats browser sweeps here. |
| Auth | OAuth authorize/callback state/PKCE flows have no unit tests; `real-account-auth.spec.ts` is the only e2e. Parallel JWT stack (auth-jwt, chats-v2) untested — moot since orphaned, but risky if ever revived. |
| Deploy + webhooks | 4 webhook routes: zero tests AND unreachable. `/api/deploy`, deploy-dialog, credentials: no unit tests (only connect-domain + subscription-verify-deploy touch deployment). |
| RLHF/insights | `rlhf-user-journey.spec.ts` only; `/api/rlhf/insights` and `/api/rlhf/export` untested; export has no consumer to catch drift. |
| Legacy chat surface | /chats routes, chat-selector duplicate/rename, preview-panel A2UI toggle: no dedicated tests; chat-menu fetches routes that don't exist (would fail silently). |
| Templates/design-tokens/commands/skills | Template submission+admin review: untested. Design-token parse/version/revert: untested. Command palette execution: only command-client/variables unit tests. Skills API has a test (`api/skills.test.ts`) for orphaned routes. |
| Evidence/rules | `evidence.test.ts` + `evidence-verify.test.ts` exist (API-level); UI and rules engine (validate/auto-fix/stats/violations) have only `built-in-rules.test.ts`. |
| Dormant-path tests giving false comfort | `verify-loop.test.ts`, `trajectory-static-verify.test.ts`, `agent-runtime.test.ts`, `mcp-provision.test.ts`, `ainative-mcp-client.test.ts` all pass while the code they test is unreachable in prod. |
| Broken spec | `e2e/primitive-tooltips.spec.ts` targets `/test-components/primitive-chips` — harness route does not exist (404). |
| Nightly loop | `/api/build/nightly-loop` has no external-trigger integration test; no in-repo cron means no CI signal it ever runs. |

---

## 5. Stale docs

By last git-modified date vs current reality:

**Stale — describe dormant/orphaned features as if live (2026-03-02 batch):** `docs/CUSTOM_PROMPTS_GUIDE.md` (prompt A/B UI-less), `docs/api/rule-enforcement.md`, `docs/features/RULE_ENFORCEMENT.md`, `docs/guides/rule-enforcement-quickstart.md`, `docs/reports/rule-enforcement-implementation-summary.md` (rules UI unreachable), `docs/features/command-palette-implementation.md` + `command-palette-quickstart.md` (reference orphaned seed script), `docs/context-budget-implementation-summary.md` + `docs/context-budget-manager.md` (2026-04-05) (demo-route-only feature), `docs/DEPLOYMENT_GUIDE.md`, `PRODUCTION_DEPLOYMENT_README.md`, `PRODUCTION_DEPLOYMENT_SUMMARY.md`, `PRODUCTION_ENV_SETUP.md` (pre-date Railway-CLI deploy reality + broken GH auto-deploy #301), `docs/MONITORING_QUERIES.md`, `docs/quick-reference/QUICK_SUMMARY.md`, all `docs/reports/*` one-off completion summaries (FIXES_SUMMARY, PREVIEW_FIX_COMPLETE, IMPLEMENTATION_SUMMARY, GITHUB_SETUP_COMPLETE, AINATIVE_INTEGRATION_*), `docs/testing/ISSUE-11-*`.

**Stale — architecture superseded:** `docs/chunking-architecture.md` + `chunking-implementation-status.md` (2026-03-31 — chunking rarely fires; decomposition.ts is the live mechanism), `docs/SUBAGENT_ARCHITECTURE.md` (2026-04-05 — USE_SUBAGENTS=false), `docs/PRD_HEADLESS_CLAUDE_AGENT.md` (2026-06-25 — agent runtime bypassed by Bedrock-primary), `docs/MODEL_USAGE.md` + `docs/bay-view-token-limit-analysis.md` + `token-limit-research-findings.md` (pre-16k-token/Bedrock-Opus fix), `docs/competitor-analysis-2025.md` (superseded by Polsia docs in growth/), `docs/PRODUCTION-READINESS-AUDIT.md` (2026-04-03), `docs/reports/code-generation-audit-2026-03-03.md`.

**Partially stale:** `docs/design/BUILDER_DESIGN_HANDOFF.md`, `CODY_CLI_INTEGRATION.md` (cody OFF pending fixes), `PLATFORM_IMPROVEMENT_PLAN.md`, `COMPONENT_IMPORT_CONTRACT.md`, `REAL_AIKIT_COMPONENTS.md` (2026-07-18/20 — pivot shipped, details drifted).

**Current (keep):** `docs/AINATIVE_PRIMITIVES.md`, `PRD_BUILD_FLOW_REALNESS.md` + backlog, `PERSISTENT_DEPLOY_ARCHITECTURE.md`, `WORKSPACE_AND_PROVISIONING_ARCHITECTURE.md`, `BEDROCK_ANTHROPIC_CHATCOMPLETION_GUIDE.md`, `docs/runbooks/*`, everything in `docs/growth/` (Aug 2026), `docs/audits/MOBILE_RESPONSIVENESS_AUDIT_2026-08-27.md`.

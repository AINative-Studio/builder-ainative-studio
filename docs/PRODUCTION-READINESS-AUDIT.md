# AINative Builder Studio - Production Readiness Audit

**Date:** 2026-04-02  
**Branch:** `feature/ainative-design-system-multimodel`  
**Framework:** Next.js 15.5 (Turbopack), React 19.1, TypeScript 5  
**Overall Score:** 6/10 - Significant work needed before going live

---

## Table of Contents

1. [Authentication Status](#1-authentication-status)
2. [Security Vulnerabilities](#2-security-vulnerabilities)
3. [Unintegrated & Dead Code](#3-unintegrated--dead-code)
4. [Multi-Model Support](#4-multi-model-support---broken)
5. [MCP Integration](#5-mcp-integration---partial)
6. [End-to-End Feature Completeness](#6-end-to-end-feature-completeness)
7. [Patterns to Port from Cody-CLI](#7-patterns-to-port-from-cody-cli)
8. [Critical Path to Production](#8-critical-path-to-production)

---

## 1. Authentication Status

### What's Working

| Feature | Status | Files |
|---------|--------|-------|
| Email/password login | Working | `app/(auth)/auth.ts` |
| AINative API auth (credentials) | Working | `app/(auth)/auth.ts:22-70` |
| JWT tokens (httpOnly cookies) | Working | `lib/auth-jwt.ts` |
| Session management (Redis + PG) | Working | `lib/session-manager.ts` |
| NextAuth.js integration | Working | `app/api/auth/[...nextauth]/route.ts` |
| Guest user support | Working | `app/api/auth/guest/route.ts` |
| Protected page routes (edge middleware) | Working | `middleware.ts` |
| Password hashing (bcrypt) | Working | `lib/db/queries.ts` |
| User type system (guest/regular/ainative) | Working | `app/(auth)/auth.ts` |
| Chat ownership enforcement | Working | `app/api/chat/ownership/route.ts` |

### What's Missing

| Feature | Priority | Notes |
|---------|----------|-------|
| Rate limiting on auth endpoints | HIGH | Commented out in middleware - need to re-enable |
| Account lockout after failed attempts | MEDIUM | Not implemented in this app's middleware |
| MFA / 2FA | LOW | Not implemented in this app (not yet in core either) |

### Auth File Map

```
app/(auth)/auth.ts              - NextAuth config + AINative API integration
app/(auth)/auth.config.ts       - Auth configuration
app/(auth)/actions.ts           - Server actions (signIn/signUp/signOut)
app/(auth)/login/page.tsx       - Login page
app/(auth)/register/page.tsx    - Register page
app/api/auth/[...nextauth]/     - NextAuth handler
app/api/auth/login/route.ts     - Login endpoint
app/api/auth/register/route.ts  - Registration endpoint
app/api/auth/logout/route.ts    - Logout endpoint
app/api/auth/guest/route.ts     - Guest signup
lib/auth-jwt.ts                 - JWT utilities (JOSE, HS256)
lib/auth-middleware.ts           - API route auth helpers
lib/session-manager.ts           - Session management (Redis + PG)
middleware.ts                    - Edge middleware for route protection
components/auth-form.tsx         - Auth form UI
components/providers/session-provider.tsx - NextAuth provider
```

---

## 2. Security Vulnerabilities

### CRITICAL

#### 2.1 Exposed Secrets in `.env`
- **File:** `.env`
- Database passwords, Anthropic API key, Meta API key, AINative credentials, Unsplash keys all committed
- **Action:** Rotate ALL credentials immediately, remove from git history with `git filter-branch` or BFG Repo-Cleaner

#### 2.2 `eval()` in Preview API
- **File:** `app/api/preview/[id]/route.ts:880`
- Uses `eval()` on generated code with CSP allowing `unsafe-eval` + `unsafe-inline`
- **Risk:** XSS attack vector if AI response is intercepted/modified
- **Action:** Remove eval(), use component name whitelist, sandbox execution

#### 2.3 innerHTML XSS
- **File:** `app/api/preview/[id]/route.ts:112`, `app/api/preview/simple/[id]/route.ts`
- Raw HTML strings with user input injected via innerHTML
- **Action:** Use textContent, HTML-escape all dynamic values

#### 2.4 Overly Permissive CSP
- **File:** `app/api/preview/route.ts:61`
- `script-src 'unsafe-eval' 'unsafe-inline'` defeats CSP purpose entirely
- **Action:** Use nonce-based approach, remove unsafe-eval/unsafe-inline

### HIGH

#### 2.5 Rate Limiting Disabled
- **File:** `middleware.ts:25-39`
- Rate limiting commented out: "Temporarily disabled for Edge Runtime compatibility"
- **Action:** Implement Edge-compatible rate limiting (Upstash) or per-route handlers

#### 2.6 All API Routes Bypass Auth
- **File:** `middleware.ts:56-59`
- If no token exists, ALL `/api/` routes pass through unauthenticated
- **Action:** Whitelist only public endpoints explicitly

#### 2.7 Path Traversal in Artifacts
- **File:** `app/api/artifacts/[id]/route.ts:24`
- `storage_path` from DB used directly in `fs.readFile()` with no validation
- **Action:** Validate resolved path starts within expected base directory

#### 2.8 Missing Database Ownership Checks
- **File:** `app/api/chats/[chatId]/route.ts`
- Chat retrieval doesn't verify user ownership
- **Action:** Check `chat_ownerships` before returning data

#### 2.9 Weak Password Requirements
- **File:** `app/api/auth/register/route.ts:9`
- Minimum 8 chars, no complexity requirements
- **Action:** Increase to 12+, add complexity rules

#### 2.10 Insecure AUTH_SECRET Fallback
- **File:** `app/(auth)/auth.ts:12-19`
- Falls back to `'dev-secret-key-not-for-production'` if AUTH_SECRET not set
- **Action:** Throw error in production if not set

### MEDIUM

- Missing CORS headers on API routes
- Unvalidated SQL wildcard characters in search params (`app/api/evidence/route.ts:101-109`)
- No webhook idempotency checks (`app/api/webhooks/vercel/route.ts`)
- Weak encryption key validation (`lib/services/credentials.service.ts:60-61`)
- Information disclosure in error responses (multiple API routes)
- Missing security headers in `next.config.ts` (no HSTS, no Expect-CT)

---

## 3. Unintegrated & Dead Code

### 33 Orphaned API Routes (Zero Frontend Calls)

```
/api/artifacts/[id]               /api/auth/guest
/api/chat-llama                   /api/chats-v2/[chatId]
/api/chats/[chatId]               /api/commands/execute
/api/commands/favorites           /api/commands/search
/api/credentials/[id]             /api/credentials/[id]/test
/api/deployments/[id]             /api/design-tokens/[tokenId]/*
/api/evidence/[id]/*              /api/export/[id]
/api/few-shot-examples/[id]       /api/health
/api/preview/[id]                 /api/preview/simple/[id]
/api/prompts/[id]*                /api/rules/[ruleId]
/api/skills/[skillId]/rating      /api/skills/[skillId]/usage
/api/templates/[id]               /api/usage
/api/zerodb/[...path]             /api/zerodb/schema/[tableName]
```

### 3 Complete Feature Systems Built But Never Mounted

#### Command Palette System
- Components: `command-palette.tsx`, `command-progress-tracker.tsx`, `command-variable-prompt.tsx`
- Service: `lib/services/agent-command.service.ts`
- API Routes: `/api/commands/*`
- DB Schema: `agent_commands`, `command_favorites`, `command_executions`
- **Status:** Fully built, completely disconnected from UI

#### Enforcement/Rules Dashboard
- Components: `enforcement-dashboard.tsx`, `rule-violation-list.tsx`
- Service: `lib/services/rule-enforcement.service.ts`
- API Routes: `/api/rules/*`
- DB Schema: `rules`, `rule_violations`
- **Status:** Infrastructure built, UI disconnected

#### Skills Browser/Editor
- Components: `skill-browser.tsx`, `skill-editor.tsx`
- Service: `lib/services/agent-skill.service.ts`
- API Routes: `/api/skills/*`
- **Status:** Partial implementation with TODO stubs

### 12 Unused Components

```
components/command-palette.tsx
components/command-progress-tracker.tsx
components/command-variable-prompt.tsx
components/generated-landing.tsx
components/enforcement/enforcement-dashboard.tsx
components/enforcement/rule-violation-list.tsx
components/skills/skill-browser.tsx
components/skills/skill-editor.tsx
components/ai-elements/actions.tsx (+ 9 more in ai-elements/)
```

### 5 Services with TODO/Stub Implementations

| Service | File | Issue |
|---------|------|-------|
| A2UI Action | `app/api/a2ui/action/route.ts:33` | "TODO: Forward action to agent" - just logs and returns |
| Design Tokens | `lib/services/design-tokens.service.ts` | "TODO: Implement user-specific storage" |
| Context Budget | `lib/services/context-budget.service.ts` | 3 TODO markers, returns hardcoded zeros |
| Rule Enforcement | `lib/services/rule-enforcement.service.ts` | "TODO: Fetch rule set from database" |
| Agent Skills | `lib/services/agent-skill.service.ts` | "TODO: Fetch from database" (appears twice) |

### 5 Orphaned Pages (No Navigation Links)

```
/insights          - Depends on unimplemented RLHF data
/admin/errors      - Placeholder admin check
/admin/template-submissions - Placeholder admin logic
/design-tokens     - Working UI, service marked TODO
/deployments       - Shows UI but deployment routes unused
```

### Unused Library Files

- `lib/preview-store-redis.ts` - Alternative Redis preview store, never imported

---

## 4. Multi-Model Support - BROKEN

The branch is named `feature/ainative-design-system-multimodel` but model selection is non-functional.

- **UI:** `components/home/home-client.tsx:57` has `selectedModel` state defaulting to `claude-sonnet-4`
- **API:** `app/api/chat/route.ts` ignores `selectedModel` entirely, always uses LLAMA
- **Problem:** `selectedModel` is never sent in the POST request body
- **User Impact:** User selects Claude or another model, nothing changes

### Fix Required
1. Add `selectedModel` to POST request body from home-client
2. Wire `/api/chat/route.ts` to use the selected model
3. Configure API keys/clients for each supported model

---

## 5. MCP Integration - Partial

### What Exists (Library Level)
- `lib/mcp/zerodb-client.ts` - ZeroDB API client with retry logic
- `lib/mcp/design-system-client.ts` - Design token extraction
- `lib/mcp/google-stitch-client.ts` - Unsplash image integration

### What's Missing (Agent Level)
- No Claude/Anthropic MCP tool_use integration in chat routes
- ZeroDB client exists but never called by the LLM
- No dynamic tool registration or discovery
- No prompt injection of available MCP tools
- MCP initialization race condition (not awaited on startup)

---

## 6. End-to-End Feature Completeness

### Working End-to-End

| Feature | Flow | Status |
|---------|------|--------|
| Chat + Code Generation | Input -> API -> LLAMA -> Code -> Sandpack | Working |
| Sandpack Preview | Code -> Auto-imports -> JSX fixing -> Live preview | Working |
| Template System | Request -> Match -> Customize -> Generate | Working |
| Design System | 20 themes, token upload, versioning | Working |
| Authentication | Login -> JWT -> Session -> Protected routes | Working |
| Chat History | Create -> Store (PG) -> List -> Resume | Working |

### Production Blockers

| Issue | Impact | Priority |
|-------|--------|----------|
| No React Error Boundaries | Client crash = blank page | P0 |
| Rate limiting disabled | DDoS/abuse risk | P0 |
| Multi-model broken | Feature promise not delivered | P0 |
| No DB connection pooling | Exhaustion at ~100 concurrent users | P1 |
| No global error tracking | Production issues invisible | P1 |
| MCP tools not wired to LLM | ZeroDB via chat doesn't work | P1 |
| No graceful degradation | External API down = broken UI | P2 |
| Missing skeleton loaders | Perceived performance issue | P2 |

---

## 7. Patterns to Port from Cody-CLI

The cody-cli (`/Users/aideveloper/Desktop/cody-cli`) is a production-grade agentic harness. Below are the high-value patterns organized by what they'll improve in our agents.

### 7.1 Agent Loop & Turn Management

**Source:** `src/query.ts`, `src/QueryEngine.ts`

The core agent loop is a nested async generator with clear phases per turn:
1. Context compression (snip -> microcompact -> collapse -> autocompact)
2. Message normalization and API request
3. Streaming response accumulation
4. Tool execution (concurrent-safe in parallel, others serial)
5. Continue decision (tool results -> continue, no tools -> stop)

**Stop conditions:**
- No tool_use in response (natural completion)
- Max turns exceeded
- USD budget exceeded
- User interrupt (during streaming or tools)
- Hook signaled termination
- Prompt-too-long after compaction attempts

**What to port:**
- Turn iteration with clear stop conditions
- Max turns + budget limits
- Multi-phase context compression before each API call

### 7.2 Tool Execution System

**Source:** `src/Tool.ts`, `src/services/tools/toolOrchestration.ts`, `src/services/tools/StreamingToolExecutor.ts`

**Tool definition pattern:**
```typescript
interface Tool {
  call()                    // Execute the tool
  inputSchema               // Zod schema for validation
  checkPermissions()        // Permission gating
  validateInput()           // Input validation
  isConcurrencySafe()       // Can run in parallel?
  isReadOnly()              // Safety classification
  isDestructive()           // Safety classification
  interruptBehavior()       // 'cancel' or 'block' on interrupt
}
```

**Concurrency strategy:**
- Concurrent (read-only) tools: parallel, max 10 (configurable)
- Non-concurrent (write) tools: serial
- Batching: consecutive safe tools grouped, then serial tool, then next batch
- Per-tool abort controllers (sibling errors don't cascade to independent tools)

**What to port:**
- `buildTool()` factory for consistent tool definitions
- Concurrent/serial batching for tool execution
- Per-tool abort controllers
- Tool permission checking pipeline

### 7.3 Context Window Management

**Source:** `src/utils/tokens.ts`, `src/services/compact/`

**Five-layer compression strategy:**
1. **Snip compact** - Remove old messages, keep protected tail
2. **Microcompact** - Prune cached tool results by ID
3. **Context collapse** - Group similar tool results
4. **Autocompact** - Full history summarization at token threshold
5. **Reactive compact** - Emergency recovery for prompt-too-long errors

**Token budget tracking:**
- Continue if < 90% budget consumed AND deltas > 500 tokens
- Stop if 90%+ used OR 3+ continuations with diminishing returns
- Prevents token thrashing

**What to port:**
- Token counting before API calls (prevent wasted requests)
- Progressive compression strategy
- Budget tracking with diminishing-returns detection

### 7.4 Streaming Architecture

**Source:** `src/services/api/claude.ts:1800+`, `src/utils/stream.ts`

**Custom Stream class:** Queue-based AsyncIterator with:
- Promise-based coordination between producer/consumer
- Deferred resolution (returns immediately if queue has items)
- Graceful error propagation

**Stream watchdog:**
- Idle warning at 45s, timeout at 90s (configurable)
- Stall detection: 30s inter-event gap monitoring
- Prevents hung streams

**What to port:**
- Stream idle/stall detection for our SSE responses
- Partial tool call accumulation (parse on block_stop, not per-delta)
- Progressive message yielding during tool execution

### 7.5 Prompt Engineering & Composition

**Source:** `src/constants/prompts.ts`, `src/constants/systemPromptSections.ts`

**System prompts composed from ~15+ cacheable sections:**
- Static sections: memoized per-session
- Dynamic sections: cache-breaking when context changes
- `__SYSTEM_PROMPT_DYNAMIC_BOUNDARY__` separates cacheable prefix from user-specific content

**Context injection layers:**
1. System: git status (cached snapshot, 2000 char max)
2. User: CLAUDE.md files (auto-discovered)
3. Environment: platform, model, working directory

**What to port:**
- Composable system prompt sections with caching
- Dynamic boundary for prompt cache efficiency
- Three-layer context injection (system/user/environment)

### 7.6 MCP Client Implementation

**Source:** `src/services/mcp/client.ts` (3,348 lines)

**Transport support:** stdio, SSE, HTTP, WebSocket, SDK, Claude.ai proxy

**Key patterns:**
- Memoized connection factory with lifecycle management
- Graceful degradation states: connected -> needs-auth -> failed -> disabled
- Batch connection with separate concurrency for local vs remote servers
- Tool discovery via `tools/list` with caching (LRU, max 20)
- Large result handling: persist to disk + reference (prevents context overflow)
- Session expiration detection + automatic reconnection

**What to port:**
- Multi-transport MCP client with failover
- Connection state machine (connected/needs-auth/failed/disabled)
- Large result persistence pattern
- Tool discovery caching

### 7.7 Sub-Agent / Fork Pattern

**Source:** `src/tools/AgentTool/forkSubagent.ts`

**Fork subagent:**
- Full parent context inheritance (prompt cache sharing)
- Parent's exact tool pool inherited
- Permission bubbling to parent terminal
- Max 200 turns per fork
- Recursive fork guard (prevents fork-of-fork)

**Fork child rules (injected boilerplate):**
1. No spawning sub-agents (execute directly)
2. No conversation, only tool execution
3. Use tools silently, report once at end
4. Commit changes before reporting
5. Keep report under 500 words
6. Structured output: Scope, Result, Key files, Files changed, Issues

**What to port:**
- Fork mechanism for parallel agent work
- Context inheritance for cache efficiency
- Structured output format for agent reports
- Recursive spawn guard

### 7.8 Permission System

**Source:** `src/types/permissions.ts`, `src/hooks/toolPermission/`

**Permission modes:** acceptEdits, bypassPermissions, default, dontAsk, plan, auto, bubble

**Decision pipeline:**
1. Config/policy rules (instant, offline)
2. Hook-based resolution (automated checks)
3. ML classifier (bash safety, 2s timeout)
4. Interactive dialog (user prompt)

**Multi-channel approval:** Telegram, Discord, iMessage for headless agents

**What to port:**
- Permission modes for different user trust levels
- Hook -> classifier -> dialog pipeline
- Multi-channel approval for async agents

### 7.9 Token Refresh & OAuth

**Source:** `src/bridge/jwtUtils.ts`, `src/utils/http.ts`

**Token refresh scheduler:**
- Proactive refresh 5 minutes before expiry
- Exponential backoff (max 3 consecutive failures)
- Fallback 30-minute interval for long sessions
- Generation counter prevents stale refresh chains

**OAuth 401 retry wrapper:**
- Detects 401, force-refreshes token, single retry
- Handles clock drift edge cases
- Works with async token providers

**What to port:**
- `createTokenRefreshScheduler()` -> `lib/auth/tokenRefresh.ts`
- `withOAuth401Retry()` wrapper for all API calls

### 7.10 Caching & Performance

**Source:** `src/utils/memoize.ts`, `src/utils/toolSchemaCache.ts`

**TTL memoization with background refresh:**
```
- Returns stale value immediately while refreshing in background
- In-flight dedup prevents multiple concurrent refreshes
- Async variant with cold-miss dedup (prevents multiple AWS STS logins)
```

**LRU cache with bounds:**
```
- Max 100 entries, 25MB size limit
- peek() instead of get() to avoid LRU promotion
- Prevents unbounded memory growth
```

**Session-scoped tool schema cache:**
- Prevents feature flag changes mid-session from busting prompt cache
- Clear only on auth change

**What to port:**
- `memoizeWithTTL()` and `memoizeWithTTLAsync()` -> `lib/utils/memoize.ts`
- `memoizeWithLRU()` for unbounded query results
- File state cache with partial-view tracking

### 7.11 Cost Optimization

**Source:** `src/query/tokenBudget.ts`, `src/utils/modelCost.ts`

**Per-model pricing tiers:** Haiku ($0.80/$4), Sonnet ($3/$15), Opus ($15/$75)

**Cache-aware pricing:**
- Cache write: 25% of regular rate
- Cache read: 10% of regular rate
- Prompt cache control headers for API-level caching

**Budget heuristics:**
- Continue if improving (delta > 500 tokens)
- Stop if diminishing returns (3+ turns with low deltas)
- Per-turn cost tracking with model-specific rates

**What to port:**
- Token budget tracking per generation
- Diminishing returns detection
- Model-specific cost calculation
- Prompt cache hints (`cache_control`) for Anthropic API

### 7.12 Error Recovery

**Source:** `src/services/api/withRetry.ts`, `src/services/mcp/client.ts`

**API retry logic:**
- 401/403: Token refresh + retry
- 429/529: Rate limiting/overload backoff
- Connection errors: ECONNRESET, EPIPE retry
- Max retries: 10 (configurable), max consecutive 529: 3
- Persistent retry mode for unattended sessions (heartbeat every 30s)

**MCP error recovery:**
- URL elicitation retry (max 3 attempts)
- Session expiration detection + automatic reconnection
- Graceful degradation per-server (one failure doesn't kill others)

**What to port:**
- `withRetry()` wrapper with category-specific strategies
- MCP session expiration detection + reconnect
- Graceful degradation per external service

### 7.13 Hooks System

**Source:** `src/utils/hooks.ts`

**Hook types:**
- `pre_tool_use`: Before tool execution (permission gates, validation)
- `post_tool_use`: After tool execution (logging, side effects)
- `pre_query`: Before API call (token counting, permission checks)
- `post_query`: After API returns (success/failure handlers)

**What to port:**
- Pre/post hooks for tool execution
- Hook-based permission resolution
- User-configurable shell hooks

### 7.14 Diff/Patch Handling

**Source:** `src/utils/diff.ts`, `src/tools/FileEditTool/`

**Patterns:**
- `structuredPatch()` with 3-line context, 5s timeout (regex DoS protection)
- Search-and-replace with whitespace tolerance
- File mod-time comparison before edits (concurrent edit detection)
- Line ending preservation
- Large output persistence (>50KB -> disk with XML reference tags)

**What to port:**
- Diff generation with timeout protection
- Concurrent edit detection via mod-time
- Large output persistence pattern

---

## 8. Critical Path to Production

### IMMEDIATE (Today)

| # | Task | Files | Type |
|---|------|-------|------|
| 1 | Rotate all credentials in .env | `.env` | Security |
| 2 | Remove .env from git history | git filter-branch | Security |
| 3 | Remove eval() from preview routes | `app/api/preview/[id]/route.ts` | Security |
| 4 | Fix CSP (remove unsafe-eval/unsafe-inline) | `app/api/preview/route.ts` | Security |

### WEEK 1

| # | Task | Files | Type |
|---|------|-------|------|
| 5 | Fix API route auth bypass | `middleware.ts:56-59` | Security |
| 6 | Re-enable rate limiting (Edge-compatible) | `middleware.ts`, API routes | Security |
| 7 | Wire multi-model selection to chat API | `home-client.tsx`, `app/api/chat/route.ts` | Feature |
| 8 | Add React error boundaries | `app/error.tsx`, `app/global-error.tsx` | Stability |
| 9 | Integrate AINative core token refresh in app middleware | `lib/auth/`, `middleware.ts` | Auth |
| 10 | Add DB connection pooling | `lib/db/connection.ts` | Performance |
| 11 | Add database ownership checks | `app/api/chats/[chatId]/route.ts` | Security |
| 12 | Strengthen password requirements | `app/api/auth/register/route.ts` | Security |

### WEEK 2

| # | Task | Files | Type |
|---|------|-------|------|
| 13 | Port token refresh scheduler from cody-cli | New: `lib/auth/tokenRefresh.ts` | Auth |
| 14 | Port retry logic (withRetry, withOAuth401Retry) | New: `lib/utils/retry.ts` | Reliability |
| 15 | Port TTL memoization utilities | New: `lib/utils/memoize.ts` | Performance |
| 16 | Wire MCP tools to LLM via tool_use | `app/api/chat/route.ts`, `lib/mcp/` | Feature |
| 17 | Add stream idle/stall detection | Chat streaming routes | Reliability |
| 18 | Connect or remove 33 orphaned API routes | Various | Cleanup |
| 19 | Mount or remove disconnected features | Command palette, enforcement, skills | Cleanup |
| 20 | Set up Sentry error tracking | New: error tracking config | Observability |

### WEEK 3

| # | Task | Files | Type |
|---|------|-------|------|
| 21 | Port agent tool execution system | New: `lib/agent/tools/` | Agent |
| 22 | Implement agent loop with stop conditions | New: `lib/agent/query-loop.ts` | Agent |
| 23 | Add context window management | New: `lib/agent/context/` | Agent |
| 24 | Port fork/sub-agent pattern | New: `lib/agent/fork.ts` | Agent |
| 25 | Add skeleton loaders throughout | Various components | UX |
| 26 | Implement graceful degradation | Various | Reliability |
| 27 | Add E2E tests for critical flows | New: `__tests__/e2e/` | Testing |
| 28 | Add token budget tracking | New: `lib/agent/budget.ts` | Cost |

---

## Appendix: Cody-CLI File Reference

| Pattern | Key Files |
|---------|-----------|
| Agent loop | `src/query.ts`, `src/QueryEngine.ts` |
| Tool system | `src/Tool.ts`, `src/services/tools/toolOrchestration.ts` |
| Streaming executor | `src/services/tools/StreamingToolExecutor.ts` |
| Tool execution | `src/services/tools/toolExecution.ts` |
| Permissions | `src/types/permissions.ts`, `src/hooks/toolPermission/` |
| MCP client | `src/services/mcp/client.ts` (3,348 lines) |
| Fork subagent | `src/tools/AgentTool/forkSubagent.ts` |
| Token counting | `src/utils/tokens.ts` |
| Token budget | `src/query/tokenBudget.ts` |
| Context compression | `src/services/compact/` (snip, micro, reactive, auto) |
| API streaming | `src/services/api/claude.ts:1800+` |
| Retry logic | `src/services/api/withRetry.ts` |
| OAuth flow | `src/constants/oauth.ts`, `src/services/oauth/` |
| Token refresh | `src/bridge/jwtUtils.ts` |
| HTTP client | `src/utils/http.ts` |
| Caching | `src/utils/memoize.ts` |
| System prompts | `src/constants/prompts.ts`, `src/constants/systemPromptSections.ts` |
| Cost tracking | `src/utils/modelCost.ts` |
| Hooks | `src/utils/hooks.ts` |
| Diff/patch | `src/utils/diff.ts`, `src/tools/FileEditTool/` |
| Channel permissions | `src/services/mcp/channelPermissions.ts` |
| Session history | `src/assistant/sessionHistory.ts` |
| Analytics | `src/services/analytics/index.ts` |
| Feature flags | `src/services/analytics/growthbook.ts` |
| Graceful shutdown | `src/utils/gracefulShutdown.ts`, `src/utils/cleanupRegistry.ts` |

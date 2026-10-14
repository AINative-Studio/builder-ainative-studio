# Model Usage Documentation

## Primary Model (Generation)

**Model:** Claude Sonnet 4.5 (`claude-sonnet-4-5-20250929`), env-overridable via `CLAUDE_MODEL`
**Provider:** either the direct Anthropic SDK, or Amazon Bedrock — see "Claude direct vs. Bedrock" below
**Purpose:** All UI component and application generation (`app/api/chat-ws/route.ts`)

> The older `claude-sonnet-4-20250514` ID now 404s against the project's Anthropic
> key, which used to silently force every generation onto the `gpt-oss-20b`
> fallback (mislabeled as Claude) — see the `CLAUDE_MODEL` comment in
> `app/api/chat-ws/route.ts`. `GET /api/health?model=1`
> (`lib/config/claude-model-smoketest.ts`) makes a real probe call against the
> configured ID so a future bad model ID fails loud instead of silently.

### Claude direct vs. Bedrock

Two ways to reach a Claude-family model, both exposing the same `.messages.create()`
client shape (`getPrimaryClaudeClient()`):
- **Bedrock** (`lib/bedrock-client.ts`) — used when `CODY_USE_BEDROCK=1` AND
  `AWS_BEARER_TOKEN_BEDROCK` is set (`isBedrockEnabled()`). Model ID resolves via
  `resolveBedrockModelId()`: explicit `BEDROCK_MODEL_ID`, else the inference profile
  `us.anthropic.claude-sonnet-4-5-20250929-v1:0`.
- **Direct Anthropic API** — used when Bedrock is off and `ANTHROPIC_API_KEY` is a
  real `sk-ant-` key.
- Neither configured → falls back to `ministral-14b` via the AINative Managed Chat
  API (`DEFAULT_MODEL`).

### Configuration
- Extended thinking: **Enabled** (2,000 token budget)
- Temperature: **1** (required when extended thinking is enabled)
- Max tokens: **32,000**
- Tool use: Structured component generation via `generate_component` tool
- Prompt caching: Enabled (ephemeral cache control on system prompt)

## Secondary Models (Utilities Only)

### Via AINative Managed Chat API
All non-Anthropic models route through `https://api.ainative.studio/api/v1/managed-chat/completions`,
per the real `MODEL_CONFIG` table in `app/api/chat-ws/route.ts`:

| Model Key | Tier | Notes |
|-----------|------|-------|
| `kimi-k2.6` | Premium | the paid tier's default (`PAID_MODEL`) |
| `kimi-k2` | Premium | |
| `nemotron-70b` | Premium | |
| `qwen-coder-32b` | Standard | |
| `gpt-oss-20b` | Standard | free-tier default fallback when no Claude path is configured |
| `ministral-14b` | Standard | `DEFAULT_MODEL` fallback |
| `nemotron-super-49b` | Standard | |
| `cohere-command` | Standard | |
| `codestral-22b` | Standard (intermittent) | |
| `devstral` | Standard (intermittent) | |
| `deepseek-v3` | Standard (intermittent) | |
| `qwen3-32b` | Standard (intermittent) | |

**Removed, do not use:** `nous-coder` (fully deprecated, core hard-fails it — #360);
`llama-4-maverick` (AINative caps it at 512 tokens, always truncated).

### OpenAI (Template Matching Only)
- `text-embedding-ada-002` - Template similarity matching (Epic 5)
- Used in `lib/services/template-matcher.service.ts`

## Environment Variables

```bash
# Primary generation — direct Anthropic path
ANTHROPIC_API_KEY=sk-ant-...
CLAUDE_MODEL=claude-sonnet-4-5-20250929  # Optional, this is the default

# Primary generation — Bedrock path (takes priority over direct Anthropic when both are set)
CODY_USE_BEDROCK=1
AWS_BEARER_TOKEN_BEDROCK=...
BEDROCK_MODEL_ID=...  # Optional, defaults to the Sonnet 4.5 inference profile

# Required for multi-model support
AINATIVE_API_TOKEN=...          # Or ZERODB_API_KEY
AINATIVE_API_BASE_URL=https://api.ainative.studio

# Optional - Template matching
OPENAI_API_KEY=sk-...
```

## Model Routing

Model selection is handled in `app/api/chat-ws/route.ts` via `MODEL_CONFIG`:
- Claude-family models (direct Anthropic or Bedrock) use `getPrimaryClaudeClient()` (supports extended thinking + tool use)
- All other models route through the AINative Managed Chat API (OpenAI-compatible)
- Default model when none is specified: `CLAUDE_MODEL`/Bedrock if configured, else `ministral-14b`

## Validation

`lib/config/model-validator.ts` logs a configuration summary at startup
(`logModelConfiguration`, called from `app/api/chat-ws/route.ts`) but its
`validateModelConfiguration()` function checks a now-removed Meta Llama
(`LLAMA_MODEL`/`META_API_KEY`) path, not the Claude/Bedrock/AINative routing
described above — it does not validate `ANTHROPIC_API_KEY` or `CLAUDE_MODEL`.
The real safety net for a bad Claude model ID is the live smoketest:
`GET /api/health?model=1` (`lib/config/claude-model-smoketest.ts`), which
makes a real, minimal probe call against the configured model ID.

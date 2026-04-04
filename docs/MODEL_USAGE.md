# Model Usage Documentation

## Primary Model (Generation)

**Model:** Anthropic Claude Sonnet 4 (`claude-sonnet-4-20250514`)
**Provider:** Anthropic (direct SDK)
**Purpose:** All UI component and application generation

### Configuration
- Extended thinking: **Enabled** (2,000 token budget)
- Temperature: **1** (required when extended thinking is enabled)
- Max tokens: **32,000**
- Tool use: Structured component generation via `generate_component` tool
- Prompt caching: Enabled (ephemeral cache control on system prompt)

### Alternative Primary Models
- `claude-opus-4-20250514` - Available for complex generation tasks
- Models via AINative API (see Secondary Models below)

## Secondary Models (Utilities Only)

### Via AINative Managed Chat API
All non-Anthropic models route through `https://api.ainative.studio/api/v1/managed-chat/completions`.

| Model Key | Model ID | Category | Use Case |
|-----------|----------|----------|----------|
| `qwen-coder-32b` | qwen-coder-32b | Code Specialist | Fast UI generation |
| `qwen-coder-7b` | qwen-coder-7b | Code Specialist | Ultra-fast prototyping |
| `nouscoder-14b` | nouscoder-14b | Code Specialist | Code generation |
| `claude-sonnet-4.5` | claude-sonnet-4.5 | Premium | Advanced generation |
| `claude-3-5-haiku` | claude-3-5-haiku | Premium | Fast Claude generation |
| `gemma-9b` | gemma-9b | General | General text/code |
| `gemma-2b` | gemma-2b | General | Ultra-fast, lightweight |
| `qwen-7b` | qwen-7b | General | General text/code |
| `deepseek-r1-distill-qwen-7b` | deepseek-r1-distill-qwen-7b | Reasoning | Complex reasoning |
| `deepseek-r1-distill-llama-8b` | deepseek-r1-distill-llama-8b | Reasoning | Reasoning tasks |

### OpenAI (Template Matching Only)
- `text-embedding-ada-002` - Template similarity matching (Epic 5)
- Used in `lib/services/template-matcher.service.ts`

## Environment Variables

```bash
# Required - Primary generation
ANTHROPIC_API_KEY=sk-ant-...
ANTHROPIC_MODEL=claude-sonnet-4-20250514  # Optional, defaults to Sonnet 4

# Required for multi-model support
AINATIVE_API_TOKEN=...          # Or ZERODB_API_KEY
AINATIVE_API_BASE_URL=https://api.ainative.studio

# Optional - Template matching
OPENAI_API_KEY=sk-...
```

## Model Routing

Model selection is handled in `app/api/chat-ws/route.ts` via `MODEL_CONFIG`:
- Anthropic models use the Anthropic SDK directly (supports extended thinking + tool use)
- All other models route through the AINative Managed Chat API (OpenAI-compatible)
- Default model: `claude-sonnet-4` if no model is specified

## Validation

Model configuration is validated on startup by `lib/config/model-validator.ts`:
- Checks `ANTHROPIC_API_KEY` is present and valid format
- Warns if non-default model is configured
- Logs configuration summary to console

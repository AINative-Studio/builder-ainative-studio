# Chat Completions with Bedrock + Anthropic Models — Agent Guide

A 1-2-3-4 guide so an agent can call these APIs correctly and not fall off the rails.
Everything here was verified live against prod on 2026-08-26.

## The #1 thing to understand first

There are **three different ways** to call these models, and mixing them up is where
agents fall off the rails. Pick ONE path and use its exact format:

| Path | Endpoint | Auth | Model ID format |
|---|---|---|---|
| **A. Bedrock (direct)** | `https://bedrock-runtime.{region}.amazonaws.com/model/{id}/invoke` | `Authorization: Bearer {AWS_BEARER_TOKEN_BEDROCK}` | inference profile: `us.anthropic.claude-sonnet-4-6` |
| **B. AINative API** | `https://api.ainative.studio/v1/chat/completions` | `Authorization: Bearer {AINATIVE_API_KEY}` | alias: `claude-sonnet-4.6` |
| **C. Anthropic direct** | `https://api.anthropic.com/v1/messages` | `x-api-key: {sk-ant-...}` | `claude-sonnet-4-5-20250929` |

**Default to A (Bedrock) or B (AINative). Avoid C** — this org routes everything
through Bedrock for the credits. In core, `chat.py` already routes provider
`anthropic` → Bedrock by default (`USE_BEDROCK=1`); `bedrock_provider.py` holds the
alias → inference-profile map (`BEDROCK_MODEL_MAP` / `to_bedrock_model_id`).

---

## 1 — Pick your path and use the RIGHT model ID for it

The most common failure is `HTTP 400 "The provided model identifier is invalid."`
**This means you sent the wrong ID format for your path.**

- Bedrock (Path A) wants the **inference-profile ID**: `us.anthropic.claude-opus-4-6-v1`
- AINative (Path B) wants the **alias**: `claude-opus-4.6`
- Sending `claude-opus-4-6` (bare — no `us.` prefix, no `-v1`) to Bedrock → **400**.

**Before you build anything, verify the model actually works** with a one-line probe:

```bash
curl -s -o /dev/null -w "%{http_code}\n" -X POST \
  "https://bedrock-runtime.us-east-1.amazonaws.com/model/us.anthropic.claude-sonnet-4-6/invoke" \
  -H "Authorization: Bearer $AWS_BEARER_TOKEN_BEDROCK" \
  -H "Content-Type: application/json" \
  -d '{"anthropic_version":"bedrock-2023-05-31","max_tokens":8,"messages":[{"role":"user","content":"hi"}]}'
```

- `200` = usable.
- `403` = not entitled → **don't use it, don't substitute** — pick another model.
- `400` = wrong ID format (see above).

**Entitled on this account (us-east-1, verified 200):**
`us.anthropic.claude-sonnet-4-5-20250929-v1:0`, `us.anthropic.claude-sonnet-4-6`,
`us.anthropic.claude-opus-4-5-20251101-v1:0`, `us.anthropic.claude-opus-4-6-v1`.
**Not entitled (403):** opus-4-7, opus-4-8, sonnet-5, opus-5, fable-5.

---

## 2 — Use the correct request BODY shape for your path

**Bedrock (Path A)** uses Anthropic's native Messages shape — note `anthropic_version`
and `system` as a **top-level field**, NOT a message:

```json
{
  "anthropic_version": "bedrock-2023-05-31",
  "max_tokens": 16000,
  "system": "You are a helpful assistant.",
  "messages": [{ "role": "user", "content": "..." }]
}
```

Response text is at `response.content[].text` (filter `type === "text"`).

**AINative (Path B)** uses OpenAI-compatible shape — `system` is a **message**:

```json
{
  "model": "claude-sonnet-4.6",
  "max_tokens": 16000,
  "messages": [
    { "role": "system", "content": "You are a helpful assistant." },
    { "role": "user", "content": "..." }
  ]
}
```

Response text is at `response.choices[0].message.content`.

**Do not** put a `system` role message in a Bedrock request, and **do not** put
`anthropic_version` in an AINative request.

---

## 3 — Set `max_tokens` high enough (this is a silent killer)

`max_tokens` caps the OUTPUT. If your generation is longer than the cap, it gets
**truncated mid-output** — which for code produces unparseable/broken results **with
no error**. We hit exactly this: `8192` truncated complex apps → syntax errors nobody
could fix.

- **Rule:** for anything that generates substantial output (code, long docs), use
  **`16000`**, not the `8192` default.
- Estimate: ~3.5 chars per token. A 27KB output ≈ 7700 tokens — already near an 8192
  cap. Don't cut it close.
- If output looks broken/cut off, **raise `max_tokens` before blaming the model.**

---

## 4 — Fail safe: fallback, don't crash; verify, don't assume

- **Wrap every call.** These endpoints return 400/403/429/500. Catch it, log the real
  error **body** (not just the status), and fall back to a working model rather than
  throwing.
- **Never substitute silently** (ZERO MISAPPROPRIATION). If the caller asked for model
  X and X is 403, return an honest error or use a *declared* fallback chain — never
  quietly serve model Y. In core this is enforced by the `model-registry-integrity`
  skill + `tests/test_model_registry.py`.
- **Verify "live," not "deployed."** A deploy succeeding ≠ your code running. Probe an
  observable behavior (a real request returns the expected result), because
  health/version fields can be stale (CLI/tarball deploys don't update the git SHA).
- **Model IDs drift.** Don't trust an ID from memory or training data — probe it
  (step 1) before wiring it in. The `us.anthropic.…` prefix and `-v1`/date suffixes
  vary per model.

---

## The one-paragraph version

Pick a path (Bedrock-direct or the AINative `/v1` proxy). Use that path's exact
model-ID format (`us.anthropic.…` for Bedrock, `claude-x.y` alias for AINative) — a
400 "invalid model identifier" means you got this wrong. Use that path's body shape
(`anthropic_version` + top-level `system` for Bedrock; OpenAI `messages` with a system
message for AINative). Set `max_tokens: 16000` for anything long or it'll truncate
silently. Probe every model with a `curl` for a `200` before trusting it, wrap calls in
try/catch with an honest fallback, and verify by real request — never by "the deploy
went green."

---

*Source of truth in this repo:* `src/backend/app/providers/bedrock_provider.py`
(`BEDROCK_MODEL_MAP`, `to_bedrock_model_id`), `app/api/api_v1/endpoints/chat.py`
(provider routing), `app/services/model_registry.py` (aliases + tiers).

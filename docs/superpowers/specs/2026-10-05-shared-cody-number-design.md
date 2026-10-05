# Shared "Text Cody" number — design spec

**Date:** 2026-10-05
**Status:** draft, pending approval

## Problem

AINative owns a real, working phone number (`+1 937-764-2838`) that is wired to ZeroVoice's SMS relay and confirmed live (a real end-to-end delivery test on 2026-10-05 succeeded). Today this number is not surfaced anywhere in Builder's UI, and texting it from a phone number not already tied to a provisioned, per-company ZeroVoice number gets **no reply at all** — `handleInboundSms` in `app/api/webhooks/zerovoice-sms/route.ts` explicitly refuses to converse unless the inbound `To` number resolves to exactly one company (`resolveAppByZeroVoiceNumber`), by design ("no default/fallback company, ever").

The ask: let any signed-in **paid-tier** founder text Cody on this one shared number — without needing to separately pay ~$1.15/mo for their own dedicated ZeroVoice number — and surface that capability in the dashboard UI (a card, next to or near the existing dedicated-number card). This is a **paid-plan feature**, same tier gate (`isPaidTier`) as the existing "Get a phone number" card — not a free/anonymous capability.

**Confirmed already working, not new scope**: for founders who DO have their own dedicated ZeroVoice number, texting it already runs through the real `askCody()` + `detectEditIntent()` pipeline (same as the dashboard chat) — a real feature request texted in can already dispatch a real tracked backlog/edit task. This spec's conversation-handling logic (section 2 below) deliberately reuses that exact same pipeline for the shared number, rather than building a second, different conversational capability.

**Confirmed real gap, NOT in this spec's scope**: Cody has no live deployment/build "system status" awareness over SMS today (`askCody()` has no status-check capability wired in) — answering "is my app still deploying?" over text would need a separate, smaller follow-up (give `askCody` a tool/context source for real deployment status) and is not blocking this spec's shared-number routing work.

## Non-goals

- This does not replace or change the existing dedicated per-company number flow (`ZeroVoiceConnect.tsx`, `/api/build/zerovoice`) or its own pricing (~$1.15/mo) — that flow is for a founder who wants their OWN number (e.g. for customer-facing use); the shared number is Cody's own line for the founder's personal use. Both coexist.
- This does not add voice/call support to the shared number — SMS only, matching the existing `handleInboundSms` scope.
- This does not require changing anything on `core` or ZeroVoice's own codebase — 937 is already correctly wired to ZeroVoice's relay; all new logic lives in Builder.
- This does NOT add live deployment/system-status awareness to Cody's SMS replies — flagged above as a real, separate follow-up.

## Design

### 1. Phone → founder lookup (new)

`lib/build/founder-phones.ts` currently only supports `email → phone` writes (`recordFounderPhone`, `markFounderPhoneVerified`), both from the existing `/build` signup OTP flow (#734). Add:

```ts
export async function findFounderByPhone(e164: string): Promise<{ email: string } | null>
```

Queries the existing `builder_founder_phones` ZeroDB table for the latest `verified: true` row matching `phone === e164`. Returns `null` on no match (never throws — matches every other function in this file). **Only verified phone numbers match** — an unverified phone entry (recorded but never OTP-confirmed) must not grant SMS access to someone else's account via spoofed `From`.

### 2. Shared-number routing mode (new, alongside the existing per-company mode)

`handleInboundSms` currently does one thing: resolve `To` → company → converse. Add a second path, tried when `resolveAppByZeroVoiceNumber(to)` returns null AND `to` matches the configured shared number (`ZEROVOICE_SHARED_NUMBER` env var, `+19377642838`):

```
to === SHARED_NUMBER?
  → findFounderByPhone(from)
    → no match: reply "Text us from the phone number on your AINative account, or sign up at builder.ainative.studio" (never silently drop — a real founder on a new/different phone deserves a clear next step)
    → match found → check paid tier (isPaidTier, same check ZeroVoiceConnect.tsx's server route already does — via the founder's resolved AINative credential, NOT a client-supplied claim)
        → not paid: reply "Texting Cody is a paid-plan feature — upgrade at builder.ainative.studio to turn this on."
        → paid → listAppsForOwner(email)
            → 0 companies: reply "You don't have any companies yet — head to builder.ainative.studio to start one."
            → 1 company: proceed exactly like the existing single-company conversation flow (same askCody() call, same scopeKey derivation, same detectEditIntent() backlog-dispatch behavior)
            → 2+ companies: enter disambiguation mode (see below)
```

This is a genuinely separate code path from the existing per-company flow, not a modification to it — the existing flow's strict "no fallback" invariant is preserved unchanged for dedicated numbers. The tier check must be a real server-side lookup against the founder's actual plan (same authoritative pattern `/api/build/zerovoice`'s own doc comment insists on — "the SERVER route already does the real, authoritative tier check... every request"), never trusted from anything in the inbound SMS payload itself.

### 3. Multi-company disambiguation (new, stateful across 2 texts)

When a founder with 2+ companies texts the shared number:

- Reply: `"Which company? Reply with a number:\n1. {name}\n2. {name}\n..."` (numbered list, `app.name || app.slug`, in `listAppsForOwner`'s existing order).
- This pending-disambiguation state needs to persist between the founder's two texts (the question and their numeric reply arrive as separate webhook calls, stateless HTTP). Store it keyed by `from` number with a short TTL (e.g. 10 minutes) in the same ZeroDB table pattern as `builder_founder_phones` — a new table `builder_sms_disambiguation` (`from_number`, `companies` JSON, `expiresAt`), or reuse an existing short-lived-state mechanism if one already exists in this codebase (check `lib/build/otp.ts`'s rate-limit/expiry pattern first — it may already solve "short-lived keyed state" and be reusable rather than inventing a second one).
- Their next text is checked against a pending disambiguation for their `from` number before anything else: a bare number reply (`"1"`, `"2"`, etc.) within the TTL resolves to that company and proceeds with the conversation; anything else re-sends the numbered list; expiry falls through to re-asking fresh.
- Once resolved, do NOT re-ask on every subsequent text in the same "session" — but there's no durable way to know when a conversation has "ended" over SMS. Simplest honest choice: re-ask every time a multi-company founder's first text arrives after some period of inactivity (reuse the same TTL as a sliding "still talking about company X" window) rather than trying to track true conversation boundaries.

### 4. Dashboard UI card (new)

A new, small component (e.g. `components/build/TextCodyCard.tsx`) shown on the dashboard, gated the same way `ZeroVoiceConnect.tsx`'s button already is (paid tier via `isPaidTier`) — likely placed near `ZeroVoiceConnect.tsx` on the Live dashboard so both number options are visible together. For a non-paid founder, either hide the card entirely or show it with an "upgrade to unlock" state (mirroring the existing `reason: 'tier'` notice pattern in `ZeroVoiceConnect.tsx`) — consistent with how the rest of the dashboard already handles tier-gated features, decide which at implementation time by checking how other paid-only cards on `Live.tsx` currently present themselves to free-tier founders.

Content:

- The shared number, formatted for display: `(937) 764-2838`
- Copy: something like "Text Cody anytime at (937) 764-2838" (final copy TBD at implementation time, matching the app's existing voice) — framed as a paid-plan perk, not a free giveaway, consistent with the gate above.
- The same SMS consent disclosure language `ZeroVoiceConnect.tsx` already carries (`By texting this number, you agree to receive SMS replies from Cody...`) — same legal/compliance bar, since this is still a real two-way SMS relationship subject to the same A2P 10DLC program.
- No action button needed — there's nothing to "provision," the number already exists. This is purely informational/copy-paste convenience ("text Cody on the go").

### Error handling / edge cases

- A founder's phone is unverified (OTP never completed): texting the shared number from that number should NOT work — treat as a non-match, same as "no match" above. Don't let an unverified phone claim someone's conversation.
- A phone number is shared by two founders (e.g. family members on BUILDER with different emails, reusing a number): `findFounderByPhone` returning the single latest verified row means the most recent claim wins — acceptable, matches the "latest-wins" pattern already used elsewhere in this codebase (document-store, app-registry).
- Rate limiting: the existing OTP send path already has `checkOtpRateLimit` — check whether the shared-number conversation path needs similar protection against a flood of texts (likely yes, worth reusing the same rate-limit primitive rather than building a new one).

## Open questions for implementation time

1. Exact `builder_sms_disambiguation` TTL value (10 minutes was a placeholder above).
2. Final UI copy/placement for the card — a quick look at `Live.tsx`'s current card layout to fit this in without looking bolted-on.
3. Whether `askCody()` needs any signal that "this turn came from the shared number, not a dedicated one" for logging/analytics purposes (probably useful for understanding adoption of this free vs. paid number).

# Tracking / Analytics Audit — builder.ainative.studio

**Date:** 2026-08-24
**Scope:** GA4, Google Ads conversion, gclid/UTM attribution, Meta pixel gap.
**Method:** Read the source + curled production (`https://builder.ainative.studio`). Report-only; no app code changed.

> ⚠️ **CORRECTION (2026-08-24, post-verification):** The "gclid capture is dead code / never called" P0 below is **WRONG**. `captureAttribution()` **IS** called at `contexts/build-context.tsx:109` (`useEffect(() => { captureAttribution() }, [])` inside `BuildProvider`, which wraps the `/` and `/build` entry pages, per issue #207). Google Ads gclid attribution was **never broken**. Verified by grep + empirical round-trip test. The rest of the audit (GA4 working, pipeline server-correct, Meta pixel absent) stands. Meta pixel + CAPI have since been implemented (gated to no-op until env set).

---

## TL;DR

| Area | Status |
|---|---|
| GA4 page tracking (all pages) | ✅ WORKING — live on `/`, `/build`, `/compare/*` |
| GA4 funnel events (client) | ✅ WORKING — 7 distinct events wired |
| Google Ads conversion pipeline (code) | ✅ WIRED — server → core `/events/track` keyed by gclid |
| **gclid / UTM capture on the client** | 🔴 **BROKEN — capture function is dead code, never called. No `ax_gclid` / `ax_utm` cookie is ever written.** |
| Register-time gclid promotion (core Stripe path) | ⚠️ CODE-CORRECT but starved — depends on the same never-written cookie |
| Meta pixel + CAPI | 🔴 MISSING entirely |
| Whether conversions actually reach Google Ads | ⚠️ UNVERIFIED from code (fire-and-forget to core; no receipt) |

**The single most important finding:** the entire gclid attribution chain is server-correct but **the cookie it reads is never set**, because `captureAttribution()` has no call site. Every server-side `reportConversion(...)` and the register-time gclid promotion currently no-op for real ad traffic. **This must be fixed before spending on Google or Meta**, or paid clicks will convert with zero attribution and Smart Bidding / Meta CAPI will be blind.

---

## 1. Full conversion path (traced end-to-end in code)

**Intended flow:**
```
Ad click (?gclid=…) → landing → captureAttribution() writes ax_gclid cookie (90d)
   → anonymous build flow …
   → LEAD:  POST /api/build/lead   → reportConversion(gclid) → core /events/track → Google Ads
   → SIGNUP: POST /api/build/register → core /auth/register with ext.gclid + ext.utm (nested)
   → PAID:  POST /api/build/subscription/verify → reportConversion(gclid) → core → Google Ads
                                                  (+ core Stripe webhook reads users.gclid)
```

**What each piece actually does:**

- **Capture** — `lib/build/attribution.ts`
  - `captureAttribution()` reads `gclid` / `gbraid` / `wbraid` + `utm_*` from the URL and writes first-party cookies `ax_gclid` (90d, `SameSite=Lax`) and `ax_utm` (JSON). Idempotent (last ad click wins). **Logic is correct.**
  - 🔴 **`captureAttribution()`, `getGclid()`, and `getUtm()` are never imported or called anywhere in `app/`, `components/`, or `lib/`.** `BuildApp.tsx` and the homepage have no mount-time call. Grep confirms zero call sites. **Result: no cookie is ever set, so every downstream read returns `undefined`.**

- **Server read** — `lib/build/conversions.ts::gclidFromRequest(request)` parses `ax_gclid` from the request `Cookie` header. Correct — but the cookie doesn't exist, so it returns `undefined`.

- **Report to Google Ads** — `lib/build/conversions.ts::reportConversion(e)`
  - POSTs to `${AINATIVE_API_URL||https://api.ainative.studio}/api/v1/events/track` with `google_ads_click_id: e.gclid`, `conversion_value`, `currency`, `session_id`, `form_data{source:'builder',slug,plan,email}`. 15s timeout, best-effort, never throws.
  - **Early-returns `false` when `!e.gclid`** (line 31) — by design, organic has nothing to attribute. But because the cookie is never set, **it early-returns for paid clicks too.**

- **LEAD conversion** — `app/api/build/lead/route.ts` (line 70): fires `reportConversion({eventType:'lead_captured', value:5, gclid: gclidFromRequest(request), …})` after storing the email in ZeroDB `builder_leads`. Also attaches email to the `#270` learning row. ✅ Wired.

- **PAID conversion** — `app/api/build/subscription/verify/route.ts` (line 82): after core verifies `paid`, fires `reportConversion({eventType:'subscribed', value: PLAN_VALUE[plan] ?? 49, gclid: gclidFromRequest(request), …})`, marks the company converted, and claims the tmp_ → permanent project. ✅ Wired.
  - Note: **`app/api/build/provision/route.ts` does NOT call `reportConversion`** — provisioning is not the paid-conversion moment; `subscription/verify` is. That's correct, but worth stating since the task hinted the paid hook lived in provision.

- **Register-time attribution** — `app/api/build/register/route.ts` (line 34): reads `gclid` + `utm` from cookies, registers against core `/auth/register` with `signup_source:'builder'` and `ext.gclid` (flat) + `ext.utm.{utm_source,utm_medium,utm_campaign}` (**nested** — matches the core gotcha; comment on lines 48–61 documents `auth.py: _ext.get("utm")`). When paid, core's Stripe webhook reads `users.gclid` and uploads to Ads. ✅ Code-correct — but again starved by the missing cookie.

**Bottom line on the path:** every server hop is implemented and correct. The chain is broken only at the very first step — the cookie is never written.

---

## 2. GA4 on production (verified live)

`components/analytics/google-analytics.tsx` mounted in `app/layout.tsx:232` (root layout → all routes).

- Measurement ID `G-L8T0TB6M2C`; env `NEXT_PUBLIC_GA_ID` with a **hardcoded fallback** (`|| 'G-L8T0TB6M2C'`), so GA works even if the env var is unset.
- Loads `gtag/js` (`afterInteractive`) + `gtag('config', …)` with `page_title` / `page_location`.

**Curl verification (production, 2026-08-24):**

| Page | `googletagmanager` | `G-L8T0TB6M2C` |
|---|---|---|
| `/` | ✅ | ✅ |
| `/build` | ✅ | ✅ |
| `/compare/lovable` | ✅ | ✅ |
| `/compare/bolt` | ✅ | ✅ |

GA4 pageview tracking is **live on all key pages.**

---

## 3. GA4 conversion events actually sent

`trackEvent(action, category, label?, value?)` → `gtag('event', …)`. Found **7 call sites**:

| Event (`action`) | Category | Where |
|---|---|---|
| `generate_app` | engagement | `components/home/home-client.tsx:238` |
| `idea_submitted` | funnel | `components/build/screens/Intake.tsx:18` |
| `sign_up` | funnel | `components/build/screens/Auth.tsx:61` |
| `checkout_started` | funnel | `components/build/screens/Pricing.tsx:51` |
| `upgrade_clicked` | funnel | `components/build/screens/Live.tsx:94` |
| `lead_captured` | funnel | `components/build/screens/Live.tsx:120` |
| `subscribed` (**conversion**) | conversion | `components/build/screens/Live.tsx:154` |

So GA4 gets **more than pageviews** — a full client-side funnel including a `subscribed` conversion event. ⚠️ These are client `gtag` events; **none are currently marked as GA4 "key events" / imported into Google Ads** (that's a GA4/Ads console config step, not code — see checklist). GA4 event tracking depends only on GA4 being loaded (it is), **not** on the gclid cookie.

---

## 4. Gaps for campaign launch

### 4a. Google Ads conversion action — reaching Ads or just logged?
- **Code path exists** (server → core `/events/track` with `google_ads_click_id`, and the core Stripe webhook path via `users.gclid`). The Builder has no Ads credentials by design; **core** does the actual upload.
- **Cannot confirm from this repo** that core actually uploads to a live Google Ads **conversion action** — `reportConversion` is fire-and-forget and doesn't inspect the response body. **Verify on the core side / in the Google Ads UI** that (i) `/events/track` maps `google_ads_click_id` → an active Enhanced-Conversions-for-Leads / OCI conversion action, and (ii) the Stripe-webhook `users.gclid` path is live.
- 🔴 **Blocking regardless:** with no `ax_gclid` cookie ever set, every `reportConversion` call currently no-ops for real ad traffic.

### 4b. Meta pixel + CAPI — completely missing (spec to implement)
`fbq` / `connect.facebook.net` absent from the codebase and from production HTML (curl confirmed). To be Meta-ready, add:

1. **Env:** `NEXT_PUBLIC_META_PIXEL_ID` (browser) + `META_CAPI_ACCESS_TOKEN` (server, secret). Add both to `.env.example`.
2. **Pixel init in layout:** a `components/analytics/meta-pixel.tsx` (mirroring `google-analytics.tsx`) mounted in `app/layout.tsx` beside `<GoogleAnalytics />`: standard `fbq('init', PIXEL_ID)` + `fbq('track','PageView')`, `afterInteractive`.
3. **Client Standard Events** (mirror the GA4 funnel, dedup-keyed with an `eventID`):
   - `Lead` → on lead capture (`Live.tsx:120`)
   - `CompleteRegistration` → on signup (`Auth.tsx:61`)
   - `InitiateCheckout` → on `checkout_started` (`Pricing.tsx:51`)
   - `Purchase` (with `value` + `currency`) → on `subscribed` (`Live.tsx:154`)
   - optional `Lead`/`ViewContent` on `idea_submitted`
4. **Server-side CAPI** (recommended for iOS/ad-blocker coverage + match quality): a `sendCapiEvent()` in `lib/build/conversions.ts` (or a sibling) that POSTs to `https://graph.facebook.com/v20.0/{PIXEL_ID}/events` with `access_token`, hashed `em` (email), `fbc` (from the `_fbc` cookie / `fbclid`), `fbp` cookie, and the **same `event_id`** as the browser event (dedup). Fire it from `/api/build/lead` (Lead) and `/api/build/subscription/verify` (Purchase), exactly where `reportConversion` already fires.
5. **fbclid capture:** extend the attribution fix (4c) to also persist `fbclid` → `_fbc` and read `_fbp`, so CAPI has click-match parameters — the Meta analogue of gclid.

### 4c. UTM / gclid persistence — the actual break
- 🔴 **`captureAttribution()` is never invoked.** The 90-day `ax_gclid` / `ax_utm` cookies are never written, so:
  - `gclidFromRequest()` in `/lead` and `/subscription/verify` → `undefined` → `reportConversion` early-returns (no Google Ads upload).
  - `/register` sends `ext.gclid: undefined` and `ext.utm` collapses to the `gclid ? 'google'/'cpc'` fallbacks only (campaign dropped) → core Stripe webhook has no `users.gclid` to attribute.
- The **nested-utm / flat-gclid** handling itself is correct (`register/route.ts` nests utm under `ext.utm`, sends gclid flat) — but it's fed empty values.
- **Fix (one line + a mount):** call `captureAttribution()` once on mount at the top of the funnel — in `components/build/BuildApp.tsx` (and ideally `home-client.tsx`) inside a `useEffect(() => { captureAttribution() }, [])`. That single wire-up revives the entire Google Ads chain. Verify by loading `/build?gclid=TEST123&utm_source=google&utm_campaign=x` and confirming the `ax_gclid` cookie is set, then that a lead POST carries it.

---

## Prioritized checklist — "campaign-ready"

**P0 — before any ad spend (Google & Meta):**
- [ ] **Wire `captureAttribution()` on mount** in `BuildApp.tsx` (and `home-client.tsx`). Without this, all gclid/UTM attribution is dead. *(one `useEffect`)*
- [ ] Manually verify: land `/build?gclid=TEST&utm_source=google&utm_campaign=t` → `ax_gclid` + `ax_utm` cookies set → `/api/build/lead` and `/subscription/verify` receive the gclid.

**P1 — Google Ads:**
- [ ] Confirm on the **core** side that `/api/v1/events/track` (`google_ads_click_id`) + the Stripe-webhook `users.gclid` path actually upload to a **live, active Google Ads conversion action** (not just logged). Test with a real gclid end-to-end.
- [ ] In **GA4**, mark `subscribed` (and `lead_captured`) as **Key Events**; import them into Google Ads as backup conversions.
- [ ] Add attribution `gtag('set', 'user_data'…)` / Enhanced Conversions if using GA4-imported conversions.

**P2 — Meta:**
- [ ] Add `NEXT_PUBLIC_META_PIXEL_ID` + `META_CAPI_ACCESS_TOKEN` env (+ `.env.example`).
- [ ] Add `components/analytics/meta-pixel.tsx`, mount in `app/layout.tsx` (PageView).
- [ ] Add `fbq` Standard Events: Lead, CompleteRegistration, InitiateCheckout, Purchase(value,currency) — mirror the 7 GA4 events, each with an `event_id`.
- [ ] Add server-side **CAPI** from `/api/build/lead` (Lead) + `/subscription/verify` (Purchase), dedup-keyed by `event_id`, with hashed email + `fbc`/`fbp`.
- [ ] Extend attribution capture to persist `fbclid` → `_fbc`.

**P3 — hardening:**
- [ ] Give `reportConversion` a lightweight success signal / log so Ads uploads are observable (currently silent fire-and-forget).
- [ ] Consider a Consent Mode v2 banner before EU spend (GA4 + Meta both need it for full measurement).

---

## Evidence index (files read)
- `components/analytics/google-analytics.tsx` — GA4 init + `trackEvent`/`trackPageView`
- `app/layout.tsx:232` — `<GoogleAnalytics />` mount
- `lib/build/attribution.ts` — capture (🔴 dead code, no call site)
- `lib/build/conversions.ts` — `reportConversion`, `gclidFromRequest` (reads `ax_gclid` cookie)
- `app/api/build/lead/route.ts:70` — LEAD conversion
- `app/api/build/subscription/verify/route.ts:82` — PAID conversion
- `app/api/build/register/route.ts:34,54` — register-time gclid + nested utm to core
- `app/api/build/provision/route.ts` — provisioning (no conversion call — correct)
- funnel `trackEvent` sites: `home-client.tsx:238`, `Intake.tsx:18`, `Auth.tsx:61`, `Pricing.tsx:51`, `Live.tsx:94,120,154`
- Production curl (2026-08-24): GA present on `/`, `/build`, `/compare/lovable`, `/compare/bolt`; `fbq`/Meta absent everywhere.

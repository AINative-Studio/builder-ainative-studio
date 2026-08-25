# Meta Ads MCP — setup & activation

**Status (2026-08-24):** Installed + wired into MCP config. **Blocked only on a Meta access token** (placeholders in place). 36 tools verified live over stdio.

## What was adopted
- Package: **`meta-ads-mcp`** (pipeboard-co), PyPI v1.0.120, MIT. The de-facto community Meta Ads MCP (178 releases, actively maintained).
- Chosen because it supports **self-hosted direct Meta token auth** (`META_ACCESS_TOKEN`, highest precedence) — no dependency on any third-party SaaS. Pipeboard's hosted token path is optional and we are NOT using it.
- Installed via `uv tool install meta-ads-mcp` → binary at `/Users/aideveloper/.local/bin/meta-ads-mcp`.

## Config (already added to `~/.claude.json` → mcpServers.meta-ads)
```json
"meta-ads": {
  "type": "stdio",
  "command": "/Users/aideveloper/.local/bin/meta-ads-mcp",
  "args": [],
  "env": {
    "META_ACCESS_TOKEN": "REPLACE_WITH_META_SYSTEM_USER_TOKEN",
    "META_APP_ID": "REPLACE_WITH_META_APP_ID",
    "META_APP_SECRET": "REPLACE_WITH_META_APP_SECRET",
    "META_ADS_DISABLE_LOGIN_LINK": "1",
    "META_ADS_DISABLE_CALLBACK_SERVER": "1"
  }
}
```
(The two `DISABLE` flags keep it headless — no interactive OAuth link / callback server, which we don't want in an MCP context.)

## To activate (human steps in Meta Business Manager — ~15 min)
1. **Meta App:** developers.facebook.com → create an app (type: Business) → note **App ID** + **App Secret**. Add the **Marketing API** product.
2. **System User token (recommended over user token — doesn't expire on logout):** Business Settings → Users → System Users → add a System User (Admin) → **Generate token** for the app with scopes: `ads_management`, `ads_read`, `business_management`, `read_insights`. Generate a **long-lived / non-expiring** system-user token.
3. **Assign the ad account** to the System User (Business Settings → Accounts → Ad Accounts → assign, with full control).
4. Drop the three values into the config above (`META_ACCESS_TOKEN` = system-user token) and restart the Claude session so the MCP reloads.
5. Verify: ask to run `get_ad_accounts` — should return `act_...` for the AINative ad account.

## The 36 tools (campaign lifecycle)
- **Accounts:** get_ad_accounts, get_account_info, get_account_pages, search_pages_by_name
- **Campaigns:** get_campaigns, get_campaign_details, create_campaign, update_campaign
- **Ad sets:** get_adsets, get_adset_details, create_adset, update_adset
- **Ads:** get_ads, get_ad_details, create_ad, update_ad
- **Creatives:** get_ad_creatives, create_ad_creative, update_ad_creative, get_creative_details, get_ad_image, get_image_by_hash, get_ad_video, upload_ad_image, compute_image_crops
- **Targeting:** search_interests, get_interest_suggestions, search_behaviors, search_demographics, search_geo_locations, estimate_audience_size
- **Budget:** create_budget_schedule
- **Insights/competitive:** get_insights, **search_ads_archive** (pull competitors' live ads from Meta Ad Library — e.g. see exactly what Polsia is running)
- Generic: search, fetch

## Note
New campaigns default to **paused** (package safety model) — review before enabling. Wire Meta conversions to the same tracking as Google (gclid→paid-conversion pipeline, signup_source:builder) so ROAS is comparable across channels.

---
## Campaign draft (created PAUSED, 2026-08-24)
- **Campaign** `120250720408120749` — "Builder — App Builder (Traffic)", OUTCOME_TRAFFIC, PAUSED.
- **Ad set** `120250720425900749` — "Builders & Founders — US (interests)", $40/day, LINK_CLICKS, PAUSED. Targeting: US, age 22–55, FB+IG, interests = Startup company (6003325004380) + SaaS (6003344765839) + Web development (6003290005325), advantage_audience=off.
- **Ad creative: NOT created — hard-blocked on a Facebook Page.** Meta ad creatives must be tied to a Page. Once the Page exists + is assigned to the `ainative-mcp` system user, create the creative.

### Creative spec (ready to build once Page exists)
- **Format:** single video (or 4:5 image fallback). **Angle Polsia can't run:** a screen-capture of `/build` generating a REAL app live.
- **Primary text:** "Describe your idea. Watch Cody build a real, runnable app — and you own the code, backend, and business systems. Not a demo. Not a black box."
- **Headline:** "Watch your app build itself"  **Description:** "Real apps you own. Start free."
- **CTA:** "Learn More"  **Landing:** https://builder.ainative.studio/build  (conquest variant → /compare/polsia)
- Add `fbclid`→conversion tracking (Meta pixel work in progress under task #7).

### Blockers to SERVE (Toby)
1. Attach a payment method to act_1054115077255761 (currently none).
2. Create a Facebook Page + assign it to the ainative-mcp system user.
3. Then: create creative + ad, review, un-pause.

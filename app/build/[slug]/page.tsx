import type { Metadata } from 'next'
import { resolveAppVerified } from '@/lib/build/app-registry'
import { StandalonePreviewRegenerate } from '@/components/build/StandalonePreviewRegenerate'
import { StandalonePreviewFrame } from '@/components/build/StandalonePreviewFrame'
import { mintPreviewDbToken } from '@/lib/build/preview-tokens'

/**
 * /build/{slug} (#207 · FIX-2) — the REAL, shareable URL for a generated company
 * or app. Resolves the brand slug to its generated app's chatId and renders the
 * actual running app in a branded frame. Replaces the dead
 * {slug}.ainative.studio subdomain — no DNS, works immediately.
 *
 * #1066: the actual preview rendering (Sandpack for multi-file generations,
 * iframe /api/preview/{chatId} for single-file ones) lives in
 * StandalonePreviewFrame — see that file's doc comment for why.
 */

export const runtime = 'nodejs'

// resolveAppVerified() reads live per-slug company/app data on every request,
// and the rendered shell embeds that app's current chatId/color/name —
// without an explicit directive Next.js can still apply its default
// long-lived static caching (`s-maxage=31536000`) to this route, serving a
// stale resolution after a deploy or an app update (#818). Force per-request
// rendering so this always reflects the latest data.
export const dynamic = 'force-dynamic'

interface Props { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params
  const { entry } = await resolveAppVerified(slug)
  const name = entry?.name || slug
  return {
    title: entry ? `${name} — built on AINative` : `${slug} — AINative Builder`,
    description: entry?.tagline || `${name}, built and run on AINative.`,
    alternates: { canonical: `https://builder.ainative.studio/build/${slug}` },
  }
}

export default async function AppSubdirPage({ params }: Props) {
  const { slug } = await params
  const { entry, verified } = await resolveAppVerified(slug)
  const color = entry?.color && /^#[0-9a-fA-F]{6}$/.test(entry.color) ? entry.color : '#2f6d86'

  if (!entry?.chatId) {
    // `verified: false` means the registry lookup itself failed (rate limit,
    // timeout, a ZeroDB-side outage like core#7395) — NOT a confirmed "no
    // such company." This page used to call the plain resolveApp(), whose
    // ambiguous `null` return collapses both cases identically (the exact
    // anti-pattern #832 fixed for the resolve-app API route and
    // build-context.tsx's deep-link check, but this public rendering
    // surface — the actual page priority-1 rendering checks hit — was never
    // given the same fix). Telling a real visitor "still being built" for an
    // app that is actually live and complete, just because one registry read
    // hiccupped, is indistinguishable from a genuinely broken/stuck preview.
    if (!verified) {
      return (
        <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', background: '#f3f2f2' }}>
          <div style={{ textAlign: 'center', maxWidth: 460, padding: 24 }}>
            <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#7d7979' }}>AINATIVE BUILDER</div>
            <h1 style={{ fontSize: 28, margin: '10px 0' }}>We couldn&apos;t load this preview.</h1>
            <p style={{ color: '#444' }}>
              Something went wrong looking up <strong>{slug}</strong>. This is usually temporary —{' '}
              <a href={`/build/${slug}`} style={{ color }}>reload the page</a> in a moment.
            </p>
          </div>
        </div>
      )
    }
    return (
      <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', fontFamily: 'system-ui', background: '#f3f2f2' }}>
        <div style={{ textAlign: 'center', maxWidth: 460, padding: 24 }}>
          <div style={{ fontFamily: 'ui-monospace, monospace', fontSize: 12, color: '#7d7979' }}>AINATIVE BUILDER</div>
          <h1 style={{ fontSize: 28, margin: '10px 0' }}>This preview is still being built.</h1>
          <p style={{ color: '#444' }}>
            Cody is composing <strong>{slug}</strong>. Start your own at{' '}
            <a href="/build" style={{ color }}>builder.ainative.studio/build</a>.
          </p>
        </div>
      </div>
    )
  }

  // #1561 — mint the SAME per-company data token the single-file preview's
  // dbTokenShim attaches, server-side, right here: this Server Component
  // already has slug+chatId resolved from the verified registry entry, so
  // this needs no new public token-minting route (unlike components/build/
  // artifacts/Preview.tsx's in-session client case, which has no such
  // server boundary and is a documented fast-follow). Passed down so
  // StandalonePreviewFrame can inject the Sandpack db-token-shim when
  // routing through Sandpack (multi-file apps) instead of the same-origin
  // iframe (which needs no shim — dbTokenShim already covers it server-side).
  const dbToken = await mintPreviewDbToken(slug, entry.chatId)
  const appOrigin = (process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio').replace(/\/+$/, '')

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#fff' }}>
      {/* #844 follow-up: this used to repeat the company name + tagline right
          above the generated app's OWN header, which shows the same name/
          tagline again — a real founder saw this as a "double navigation"
          bar. This strip is pure platform attribution now (a visitor needs
          to know they can build their own here, not a second brand bar) —
          the generated app's own header is the only real nav. */}
      <header style={{ display: 'flex', alignItems: 'center', padding: '4px 18px', borderBottom: '1px solid #2a2725', background: '#151312' }}>
        <a href="/build" style={{ marginLeft: 'auto', color: '#ec3013', fontFamily: 'ui-monospace, monospace', fontSize: 11, textDecoration: 'none' }}>
          built on AINative ↗
        </a>
      </header>
      {/* #1126 follow-up: Next.js App Router does not remount this page's
          component tree just because the `slug` dynamic segment changed —
          client-side navigation between two different companies' /build/{slug}
          URLs reconciles StandalonePreviewFrame (and the SandpackProvider/
          bundler iframe nested inside it) in place rather than tearing it
          down. The self-hosted sandpack-bundler's `Bundler` is a singleton
          for the iframe's whole lifetime, so that reused iframe carries the
          PREVIOUS company's barrel-usage cache into the NEW company's
          compile — the confirmed live trigger for #1126's cross-company
          "Element type is invalid" crash, independent of whichever
          sandpack-bundler-side invalidation fix (PR #8/#9/#10 on that repo)
          eventually lands. `key={slug}` forces a real unmount/remount (fresh
          iframe, fresh Bundler, empty cache) on every company change — the
          exact same precaution app/demo/page.tsx already takes
          (`key={currentPreview}`) when its own local state swaps which
          company's preview is shown without a full page navigation. */}
      <StandalonePreviewFrame
        key={slug}
        chatId={entry.chatId}
        slug={slug}
        title={entry.name || slug}
        dbToken={dbToken}
        dbOrigin={appOrigin}
      />
      <StandalonePreviewRegenerate slug={slug} idea={entry.idea} track={entry.track} name={entry.name} />
    </div>
  )
}

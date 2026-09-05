import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { guestRegex, isDevelopmentEnvironment } from './lib/constants'
import { applyRateLimit } from './lib/middleware/rate-limit'
import { wildcardSlugFromHost, subdomainServable } from './lib/build/deploy'
import { resolveApp } from './lib/build/app-registry'

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const startTime = Date.now()

  /*
   * Playwright starts the dev server and requires a 200 status to
   * begin the tests, so this ensures that the tests can start
   */
  if (pathname.startsWith('/ping')) {
    return new Response('pong', { status: 200 })
  }

  // Liveness probe (Railway healthcheck path is /health/live). Must bypass auth
  // and rate limiting entirely — otherwise it 307-redirects to /login and the
  // deploy never passes healthcheck, so new instances never swap in.
  if (pathname.startsWith('/health')) {
    return NextResponse.next()
  }

  // Wildcard company host (#243): a request to {slug}.ainative.studio is served as
  // the company's app by rewriting the host onto the existing /build/{slug} route.
  // This gives each company a real, dedicated, CNAME-pointable host (so #240 can
  // CNAME a custom domain → {slug}.ainative.studio) without provisioning a service.
  // Only active when AINATIVE_WILDCARD_HOST is set; the apex + www are NOT rewritten.
  const wildcardSlug = wildcardSlugFromHost(
    request.headers.get('host'),
    process.env.AINATIVE_WILDCARD_HOST,
  )
  if (wildcardSlug) {
    // Product rule (#78): the subdomain must NOT resolve until the company is on a
    // PAID plan AND has explicitly CLAIMED the subdomain. Until then the shareable
    // preview is the PATH form /build/{slug}. Resolve the company and gate the serve.
    // FAIL-SAFE: any lookup error (or an unpaid/unclaimed company) → 301 to the path
    // form on the Builder origin; we never serve a broken or ungated subdomain.
    const buildPath = `/build/${wildcardSlug}${pathname === '/' ? '' : pathname}`
    const redirectToPath = () => {
      const appOrigin =
        process.env.NEXT_PUBLIC_APP_URL || 'https://builder.ainative.studio'
      return NextResponse.redirect(new URL(buildPath, appOrigin), 301)
    }
    let servable = false
    try {
      const entry = await resolveApp(wildcardSlug)
      servable = subdomainServable(entry)
    } catch (error) {
      console.error('[middleware] subdomain gate lookup failed', error)
      servable = false // fail-safe → path redirect
    }
    if (!servable) {
      return redirectToPath()
    }
    // Paid + claimed → serve the company app on its subdomain.
    // Already under /build (asset/subpath) → leave as-is; else map to the app root.
    if (!pathname.startsWith('/build/')) {
      const target = request.nextUrl.clone()
      target.pathname = buildPath
      return NextResponse.rewrite(target)
    }
    return NextResponse.next()
  }

  // /build is the new public front door (the pivot UX) — anonymous users must be
  // able to Fork → Intake → watch Cody build before any auth wall.
  if (pathname.startsWith('/build')) {
    return NextResponse.next()
  }

  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // Apply rate limiting to API routes (skip read-only polling endpoints)
  const isRateLimitExempt =
    pathname.startsWith('/api/chats') ||
    pathname.startsWith('/api/preview') ||
    pathname.startsWith('/api/auth') ||
    pathname === '/api/health' ||
    pathname === '/api/version' ||
    pathname === '/api/debug-auth'

  if (pathname.startsWith('/api/') && !isRateLimitExempt) {
    try {
      const { success, response } = await applyRateLimit(request)
      if (!success && response) {
        return response
      }
    } catch (error) {
      console.error('[middleware] Rate limit error', error)
    }
  }

  // Check for required environment variables
  if (!process.env.AUTH_SECRET) {
    console.error(
      '❌ Missing AUTH_SECRET environment variable. Please check your .env file.',
    )
    return NextResponse.next() // Let the app handle the error with better UI
  }

  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
    secureCookie: !isDevelopmentEnvironment,
  })

  if (!token) {
    // Only allow explicitly public API routes without authentication
    const isPublicApiRoute =
      pathname.startsWith('/api/auth/') ||
      pathname === '/api/health' ||
      pathname === '/api/version' ||
      pathname === '/api/debug-auth' ||
      pathname.startsWith('/api/preview/') ||
      pathname === '/api/showcase' ||
      pathname.startsWith('/api/showcase/') ||
      pathname === '/api/chat-ws' ||
      pathname === '/api/chat' ||
      pathname.startsWith('/api/rlhf/') ||
      pathname.startsWith('/api/db/') ||
      // ZeroMemory runtime proxy (#496). Self-authenticates exactly like
      // /api/db/ — the same signed per-app data token, verified inside the
      // handler; a generated app has no session cookie to present here.
      pathname.startsWith('/api/memory/') ||
      // Browser Agent runtime proxy (#499). Self-authenticates exactly like
      // /api/memory/ — the same signed per-app data token; a generated app
      // has no session cookie to present here.
      pathname.startsWith('/api/browser-agent/') ||
      // Agent402 runtime proxy (#500). Self-authenticates exactly like
      // /api/memory/ — the same signed per-app data token; a generated app
      // has no session cookie to present here.
      pathname.startsWith('/api/agent402/') ||
      // OpenCapStack runtime proxy (#503). Self-authenticates exactly like
      // /api/memory/ — the same signed per-app data token; a generated app
      // has no session cookie to present here.
      pathname.startsWith('/api/opencapstack/') ||
      // Model Catalog runtime proxy (#505). Self-authenticates exactly like
      // /api/memory/ — the same signed per-app data token; a generated app
      // has no session cookie to present here.
      pathname.startsWith('/api/model-catalog/') ||
      // AINativeNGO runtime proxy. Self-authenticates exactly like
      // /api/memory/ — the same signed per-app data token; a generated app
      // has no session cookie to present here.
      pathname.startsWith('/api/ainative-ngo/') ||
      // Developer Program runtime proxy (#505). Self-authenticates exactly
      // like /api/memory/ — the same signed per-app data token; a generated
      // app has no session cookie to present here.
      pathname.startsWith('/api/developer-program/') ||
      // Community runtime proxy (#505). Self-authenticates exactly like
      // /api/memory/ — the same signed per-app data token; a generated app
      // has no session cookie to present here.
      pathname.startsWith('/api/community/') ||
      // Founder-scoped primitive runtime proxy (#443). Self-authenticates
      // exactly like /api/db/ — a deployed company reads COMPANY_SLUG from
      // its own env, the shared preview iframe presents a signed per-app
      // token — never a session cookie, so this route was unreachable behind
      // the session gate below (a generated app has no session).
      pathname.startsWith('/api/primitive/') ||
      pathname.startsWith('/api/build/') ||
      // "I'm stuck" jump-to-answer retrieval (#321) — pure local search over the
      // guides/FAQ catalog. Lives on /help + /guides/[slug], both anonymous
      // surfaces, so it MUST work without auth (same class of bug that bit
      // /best, /about, and /test-components).
      pathname.startsWith('/api/help/') ||
      // Cron endpoints (#344, audit dormant finding #9). These are NOT session
      // routes — they're called by a scheduler and self-authenticate with
      // `Authorization: Bearer $CRON_SECRET` inside the handler (see
      // /api/cron/alerts, /api/build/nightly-loop, /api/build/learning). The
      // middleware session gate was 401'ing them BEFORE their own secret check
      // could run, so no scheduled job could ever fire. Allowlisting the path is
      // safe: every cron handler rejects a missing/wrong secret itself.
      pathname.startsWith('/api/cron/') ||
      // Webhook endpoints (#349 Gitea). These self-authenticate via HMAC
      // signature validation inside the handler, not session tokens.
      pathname.startsWith('/api/webhooks/')

    if (pathname.startsWith('/api/') && isPublicApiRoute) {
      return NextResponse.next()
    }

    // Reject all other API routes with 401 Unauthorized
    if (pathname.startsWith('/api/')) {
      return NextResponse.json(
        { error: 'Authentication required' },
        { status: 401 },
      )
    }

    // Allow homepage for anonymous users
    if (pathname === '/') {
      return NextResponse.next()
    }

    // Allow showcase pages for anonymous users (public gallery + SEO)
    if (pathname.startsWith('/showcase')) {
      return NextResponse.next()
    }

    // Allow the competitor-comparison SEO pages for anonymous users — these are
    // public marketing/landing pages ("<X> alternative") that MUST be crawlable
    // by search engines and viewable without an account. They were 307→/login,
    // which blocked indexing entirely.
    if (pathname.startsWith('/compare')) {
      return NextResponse.next()
    }

    // "Best <category>" list pages (/best/ai-app-builder, /best/vibe-coding-tools)
    // — public AEO/SEO landing pages that MUST be crawlable + ad-landable without
    // an account, else they 307→/login and block indexing + burn paid clicks (#44).
    if (pathname.startsWith('/best')) {
      return NextResponse.next()
    }

    // Founder story + vision page — public trust/AEO asset; same crawlability
    // requirement as /compare and /best. Must NOT 307→/login or search engines
    // and LLMs will never index it (#61).
    if (pathname.startsWith('/about')) {
      return NextResponse.next()
    }

    // AI Help Center — public self-serve support hub (AEO/AX asset, #60). Same
    // crawlability requirement as /about, /compare, /best: it MUST render for
    // anonymous visitors, else it 307→/login and the FAQ/answers never index and
    // the "ask anything" box is unreachable. This bug already bit /best + /about.
    if (pathname.startsWith('/help')) {
      return NextResponse.next()
    }

    // Capabilities page — the plain-English "what can I build" surface (#313/#316).
    // MUST render for anonymous visitors: prosumers discover what's possible BEFORE
    // signing up (the #1 customer ask). Same crawlability requirement as /help.
    if (pathname.startsWith('/capabilities')) {
      return NextResponse.next()
    }

    // Pricing page — public ad-landing + SEO/AEO asset; MUST be crawlable and
    // reachable without an account, else it 307→/login and burns paid ad clicks
    // and blocks search indexing (#76).
    if (pathname.startsWith('/pricing')) {
      return NextResponse.next()
    }

    // /billing is an SPA-internal screen; the route catches direct navigation
    // and redirects to /build?screen=account. Allow anonymously so the redirect
    // works before the auth gate at /build (#76).
    if (pathname.startsWith('/billing')) {
      return NextResponse.next()
    }

    // SPA-internal screens reached via GOTO_SCREEN — thin redirect routes catch
    // direct/deep links so they don't 404 or 307→login (#83). /account, /settings,
    // /profile → account screen; /refer → Refer & Earn (#59). Allow anonymously so
    // the redirect runs before the auth gate at /build.
    if (
      pathname === '/account' || pathname === '/settings' ||
      pathname === '/profile' || pathname === '/refer'
    ) {
      return NextResponse.next()
    }

    // Category landing pages (non-branded SEO/AEO targets Polsia is weak on) —
    // "AI that runs your company", "autonomous company builder", "AI co-founder".
    // MUST be crawlable + viewable without an account, else they 307→/login and
    // never index (#216).
    if (
      pathname.startsWith('/ai-company') ||
      pathname.startsWith('/autonomous-company-builder') ||
      pathname.startsWith('/ai-cofounder')
    ) {
      return NextResponse.next()
    }

    // Allow the template landing pages for anonymous users — each
    // /templates/[slug] targets an "AI <category> template" search and MUST be
    // crawlable/indexable without an account. Without this they 307→/login,
    // which blocks indexing entirely. Submit/analytics stay gated below.
    if (
      pathname === '/templates' ||
      (pathname.startsWith('/templates/') &&
        pathname !== '/templates/submit' &&
        pathname !== '/templates/analytics')
    ) {
      return NextResponse.next()
    }

    // Allow the blog/guides articles for anonymous users — the /guides index and
    // each /guides/[slug] article target long-tail keywords ("how to build a
    // SaaS with AI", "v0 vs Lovable vs AINative", "what is AX optimization") and
    // MUST be crawlable/indexable without an account. Without this they
    // 307→/login, which blocks indexing entirely.
    if (pathname === '/guides' || pathname.startsWith('/guides/')) {
      return NextResponse.next()
    }

    // Allow /docs (e.g. /docs/components) for anonymous users — these pages are
    // listed in app/sitemap.ts and MUST be crawlable/indexable without an
    // account. Without this they 307→/login, which blocks indexing entirely (#515).
    if (pathname === '/docs' || pathname.startsWith('/docs/')) {
      return NextResponse.next()
    }

    // Allow preview routes for anonymous users
    if (pathname.startsWith('/preview/')) {
      return NextResponse.next()
    }

    // Allow the component test harnesses for anonymous users (#292). These are
    // inert, isolated component mounts under /test-components/* used by Playwright
    // e2e specs (e.g. the DomainModal harness). Without this the middleware
    // redirects them to /login, so the harness never renders the component and the
    // whole suite fails locally — which is exactly the #292 symptom (the modal
    // "doesn't render locally"): it wasn't a compile divergence, the route was
    // auth-gated. They carry no real data and no privileged surface.
    if (pathname.startsWith('/test-components/')) {
      return NextResponse.next()
    }

    // Allow public JavaScript files (like shadcn-components.js)
    if (pathname.endsWith('.js') && !pathname.startsWith('/api/')) {
      return NextResponse.next()
    }

    // Redirect protected pages to login
    const protectedPaths = ['/chats', '/projects', '/deployments', '/settings', '/design-tokens', '/insights', '/admin']
    if (protectedPaths.some((path) => pathname.startsWith(path))) {
      return NextResponse.redirect(new URL('/login', request.url))
    }

    // Allow login and register pages
    if (['/login', '/register'].includes(pathname)) {
      return NextResponse.next()
    }

    // For any other protected routes, redirect to login
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const isGuest = guestRegex.test(token?.email ?? '')

  // Guest users get limited free generations before requiring registration
  // This allows the homepage suggestion buttons to work as a demo
  // Rate limiting handles abuse (10 requests/minute already configured)
  // The UI shows upgrade prompts after the free tier is exhausted

  if (token && !isGuest && ['/login', '/register'].includes(pathname)) {
    return NextResponse.redirect(new URL('/', request.url))
  }

  // Log request completion
  const duration = Date.now() - startTime
  if (duration > 1000) {
    console.warn('Slow middleware execution:', {
      path: pathname,
      method: request.method,
      duration,
    })
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/',
    '/chats/:path*',
    '/projects/:path*',
    '/api/:path*',
    '/login',
    '/register',

    /*
     * Match all request paths except for the ones starting with:
     * - _next/static (static files)
     * - _next/image (image optimization files)
     * - favicon.ico, sitemap.xml, robots.txt, manifest.json (metadata files)
     * - Next metadata image routes: opengraph-image, twitter-image, icon,
     *   apple-icon (these have NO extension, so the ext-list below misses them —
     *   without this, /opengraph-image was auth-redirected to /login and social
     *   crawlers got "/login" instead of the OG image → black default preview).
     * - static asset extensions (.png/.svg/.ico/.json/.webmanifest/.txt/.xml)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt|manifest.json|opengraph-image|twitter-image|icon|apple-icon|.*\\.(?:png|jpg|jpeg|svg|gif|ico|webmanifest|txt|xml|json|css|js|woff2?)$).*)',
  ],
}

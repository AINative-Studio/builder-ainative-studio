import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { guestRegex, isDevelopmentEnvironment } from './lib/constants'
import { applyRateLimit } from './lib/middleware/rate-limit'
import { wildcardSlugFromHost } from './lib/build/deploy'

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
    // Already under /build (asset/subpath) → leave as-is; else map to the app root.
    if (!pathname.startsWith('/build/')) {
      const target = request.nextUrl.clone()
      target.pathname = `/build/${wildcardSlug}${pathname === '/' ? '' : pathname}`
      return NextResponse.rewrite(target)
    }
    return NextResponse.next()
  }

  // Front door (#207): the root IS the /build company+app builder (one page, two
  // experiences). Redirect `/` → `/build` at the edge so the legacy app-builder
  // landing never surfaces and static caching can't serve it. Runs before auth.
  // (Wildcard company hosts are handled above and never reach this.)
  if (pathname === '/') {
    return NextResponse.redirect(new URL('/build', request.url))
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
      pathname.startsWith('/api/build/')

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

    // Category landing page ("AI that runs your company") — non-branded SEO/AEO
    // target Polsia is weak on. MUST be crawlable + viewable without an account.
    if (pathname.startsWith('/ai-company')) {
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

    // Allow preview routes for anonymous users
    if (pathname.startsWith('/preview/')) {
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

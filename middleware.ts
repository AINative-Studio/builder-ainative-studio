import { NextResponse, type NextRequest } from 'next/server'
import { getToken } from 'next-auth/jwt'
import { guestRegex, isDevelopmentEnvironment } from './lib/constants'
import { applyRateLimit } from './lib/middleware/rate-limit'

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

  if (pathname.startsWith('/api/auth')) {
    return NextResponse.next()
  }

  // Apply rate limiting to API routes
  if (pathname.startsWith('/api/')) {
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
      pathname === '/api/debug-auth' ||
      pathname.startsWith('/api/preview/')

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
     * - favicon.ico, sitemap.xml, robots.txt (metadata files)
     */
    '/((?!_next/static|_next/image|favicon.ico|sitemap.xml|robots.txt).*)',
  ],
}

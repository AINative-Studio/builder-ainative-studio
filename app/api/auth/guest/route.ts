import { redirect } from 'next/navigation'

/**
 * Guest sign-in is RETIRED (founder direction 2026-08-27): no anonymous users
 * in the funnel — registration is the entry, and the free tier is granted to
 * registered accounts. This route used to mint a guest session on GET, which
 * let bookmarks/crawlers create the confusing "Guest User" sessions seen in
 * the legacy chrome. It now routes to the real front door instead.
 */
export async function GET(request: Request) {
  const url = new URL(request.url)
  const redirectUrl = url.searchParams.get('redirectUrl')
  redirect(redirectUrl && redirectUrl.startsWith('/') ? redirectUrl : '/login')
}

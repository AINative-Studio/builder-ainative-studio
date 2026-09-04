import { NextRequest } from 'next/server'
import { resolveDiscoveryFile, discoveryContentType } from '@/lib/build/discovery-files'

export const runtime = 'nodejs'

/** GET /build/{slug}/sitemap.xml — real per-company sitemap (#493). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const content = await resolveDiscoveryFile(slug, 'sitemap.xml')
  if (content == null) return new Response('Not found', { status: 404 })
  return new Response(content, { headers: { 'Content-Type': discoveryContentType('sitemap.xml') } })
}

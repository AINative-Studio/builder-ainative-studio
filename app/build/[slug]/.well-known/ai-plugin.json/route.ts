import { NextRequest } from 'next/server'
import { resolveDiscoveryFile, discoveryContentType } from '@/lib/build/discovery-files'

export const runtime = 'nodejs'

/** GET /build/{slug}/.well-known/ai-plugin.json — real per-company agent-plugin manifest (#493). */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const content = await resolveDiscoveryFile(slug, 'ai-plugin.json')
  if (content == null) return new Response('Not found', { status: 404 })
  return new Response(content, { headers: { 'Content-Type': discoveryContentType('ai-plugin.json') } })
}

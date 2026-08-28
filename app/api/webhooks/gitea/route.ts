import { NextRequest, NextResponse } from 'next/server'
import { handlePRWebhook, type GiteaWebhookPayload } from '@/lib/git/committee-pr-gate'

/**
 * Gitea Webhook Handler — receives PR events from Gitea and runs the
 * committee gate (coding standards + multi-model review).
 *
 * Configure in Gitea:
 *   URL: https://builder.ainative.studio/api/webhooks/gitea
 *   Secret: GITEA_WEBHOOK_SECRET
 *   Events: Pull Request (opened, synchronized, reopened)
 */

const WEBHOOK_SECRET = process.env.GITEA_WEBHOOK_SECRET || ''

function verifySignature(payload: string, signature: string): boolean {
  if (!WEBHOOK_SECRET) return true // Allow if no secret configured (dev mode)
  if (!signature) return false

  const crypto = require('crypto')
  const expected = crypto
    .createHmac('sha256', WEBHOOK_SECRET)
    .update(payload)
    .digest('hex')

  return `sha256=${expected}` === signature
}

export async function POST(req: NextRequest) {
  try {
    const signature = req.headers.get('x-gitea-signature') || ''
    const event = req.headers.get('x-gitea-event') || ''

    // Only handle PR events
    if (event !== 'pull_request') {
      return NextResponse.json({ ok: true, message: `Ignored event: ${event}` })
    }

    const body = await req.text()

    // Verify webhook signature
    if (!verifySignature(body, signature)) {
      return NextResponse.json(
        { ok: false, error: 'Invalid signature' },
        { status: 401 }
      )
    }

    const payload: GiteaWebhookPayload = JSON.parse(body)
    const result = await handlePRWebhook(payload)

    return NextResponse.json({
      ok: result.ok,
      verdict: result.verdict,
      summary: result.summary,
    })
  } catch (err) {
    console.error('[gitea-webhook] Error:', err)
    return NextResponse.json(
      { ok: false, error: 'Internal error' },
      { status: 500 }
    )
  }
}

export async function GET() {
  return NextResponse.json({
    service: 'gitea-webhook',
    status: 'ready',
    configured: Boolean(WEBHOOK_SECRET),
  })
}

import { NextRequest } from 'next/server'
import { getOtpDeliveryStatus, toE164 } from '@/lib/build/otp'

export const runtime = 'nodejs'

export async function GET(request: NextRequest) {
  const phone = toE164(request.nextUrl.searchParams.get('phone') || '')
  if (!phone) return Response.json({ status: 'pending' })
  const status = await getOtpDeliveryStatus(phone)
  return Response.json({ status })
}

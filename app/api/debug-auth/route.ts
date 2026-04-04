import { NextResponse } from 'next/server'

export async function GET() {
  const authSecret = process.env.AUTH_SECRET
  const dbUrl = process.env.POSTGRES_URL

  return NextResponse.json({
    authSecretSet: !!authSecret,
    authSecretLength: authSecret?.length || 0,
    authSecretPrefix: authSecret?.slice(0, 4) || 'NOT SET',
    dbUrlSet: !!dbUrl,
    nodeEnv: process.env.NODE_ENV,
  })
}

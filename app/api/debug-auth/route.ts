import { NextResponse } from 'next/server'

export async function GET() {
  const result: Record<string, any> = {
    authSecretSet: !!process.env.AUTH_SECRET,
    authSecretLength: process.env.AUTH_SECRET?.length || 0,
    dbUrlSet: !!process.env.POSTGRES_URL,
    redisUrl: process.env.REDIS_URL ? process.env.REDIS_URL.replace(/\/\/.*@/, '//***@') : 'NOT SET',
    nodeEnv: process.env.NODE_ENV,
  }

  // Test if auth module loads
  try {
    const { auth } = await import('@/app/(auth)/auth')
    result.authModuleLoaded = true

    // Test if auth() works
    try {
      const session = await auth()
      result.authCallWorks = true
      result.session = session ? 'exists' : 'null'
    } catch (e: any) {
      result.authCallWorks = false
      result.authCallError = e.message?.slice(0, 200)
    }
  } catch (e: any) {
    result.authModuleLoaded = false
    result.authLoadError = e.message?.slice(0, 200)
    result.authLoadStack = e.stack?.slice(0, 500)
  }

  // Test DB connection
  try {
    const { db } = await import('@/lib/db')
    result.dbModuleLoaded = true
    if (db) {
      const r = await db.execute({ sql: 'SELECT 1 as ok' } as any).catch(() => null)
      result.dbQueryWorks = !!r
    }
  } catch (e: any) {
    result.dbModuleLoaded = false
    result.dbError = e.message?.slice(0, 200)
  }

  return NextResponse.json(result)
}

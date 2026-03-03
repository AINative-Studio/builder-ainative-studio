import { NextRequest, NextResponse } from 'next/server'
import { getAllUsageStats } from '@/lib/preview-store'

export async function GET(request: NextRequest) {
  try {
    const stats = getAllUsageStats()
    return NextResponse.json({ data: stats })
  } catch (error) {
    console.error('Error fetching usage statistics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch usage statistics' },
      { status: 500 }
    )
  }
}

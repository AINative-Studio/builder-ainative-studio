import { NextRequest, NextResponse } from 'next/server'
import { getAllChats } from '@/lib/preview-store'

export async function GET(request: NextRequest) {
  try {
    const chats = getAllChats()
    return NextResponse.json({ data: chats })
  } catch (error: any) {
    console.error('Error fetching chats:', error?.message, error?.stack)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}

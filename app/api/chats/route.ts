import { NextRequest, NextResponse } from 'next/server'
import { getAllChats } from '@/lib/preview-store'

export async function GET(request: NextRequest) {
  try {
    const chats = getAllChats()
    return NextResponse.json({ data: chats })
  } catch (error) {
    console.error('Error fetching chats:', error)
    return NextResponse.json(
      { error: 'Failed to fetch chats' },
      { status: 500 }
    )
  }
}

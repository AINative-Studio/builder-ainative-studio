import { NextRequest, NextResponse } from 'next/server'
import { db } from '@/lib/db'
import { templates } from '@/lib/db/schema'
import { desc, sql } from 'drizzle-orm'

export const dynamic = 'force-dynamic'

// GET /api/templates/analytics - Get template usage analytics
export async function GET(request: NextRequest) {
  try {
    // Top templates by usage
    const topTemplates = await db
      .select({
        id: templates.id,
        name: templates.name,
        category: templates.category,
        usage_count: templates.usage_count,
      })
      .from(templates)
      .orderBy(desc(templates.usage_count))
      .limit(10)

    // Category breakdown
    const categoryStats = await db
      .select({
        category: templates.category,
        count: sql<number>`count(*)`,
        total_usage: sql<number>`sum(${templates.usage_count})`,
      })
      .from(templates)
      .groupBy(templates.category)

    // Calculate total for percentages
    const totalUsage = categoryStats.reduce((sum, cat) => sum + Number(cat.total_usage), 0)

    const categoryBreakdown = categoryStats.map((cat) => ({
      category: cat.category,
      count: Number(cat.count),
      usage: Number(cat.total_usage),
      percentage: totalUsage > 0 ? Math.round((Number(cat.total_usage) / totalUsage) * 100) : 0,
    }))

    // Mock usage over time data (in real app, this would come from a time-series table)
    const usageOverTime = [
      { date: '2025-09-27', usage: 45 },
      { date: '2025-09-28', usage: 52 },
      { date: '2025-09-29', usage: 61 },
      { date: '2025-09-30', usage: 58 },
      { date: '2025-10-01', usage: 73 },
      { date: '2025-10-02', usage: 89 },
      { date: '2025-10-03', usage: 95 },
    ]

    return NextResponse.json({
      topTemplates,
      categoryBreakdown,
      usageOverTime,
      totalTemplates: topTemplates.length,
      totalUsage,
    })
  } catch (error) {
    console.error('Error fetching analytics:', error)
    return NextResponse.json(
      { error: 'Failed to fetch analytics' },
      { status: 500 }
    )
  }
}

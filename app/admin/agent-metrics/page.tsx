'use client'

/**
 * Admin Agent Metrics dashboard (#1213) — the real UI consumer for the
 * previously-orphaned GET /api/agent/metrics and GET /api/agent/export
 * (builder#57). Both routes were complete, admin-gated ZeroDB-backed
 * implementations with zero frontend callers; this page wires them up
 * following the same SWR + shadcn Card/Table pattern as the existing
 * /admin/errors dashboard.
 */

import { useState } from 'react'
import useSWR from 'swr'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { AppHeader } from '@/components/shared/app-header'
import { Activity } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then((res) => {
  if (!res.ok) throw new Error(`Request failed: ${res.status}`)
  return res.json()
})

interface AgentMetrics {
  totalRuns: number
  buildPassRate: number
  avgTurns: number
  avgDurationMs: number
  fallbackRate: number
  fallbackSuccessRate: number
  costPerGeneration: number
  days?: number
  comparisonVsFastPath: {
    agentSuccessRate: number
    fastPathSuccessRate: number
    improvement: string
  }
}

function pct(n: number): string {
  return `${Math.round(n * 100)}%`
}

export default function AgentMetricsPage() {
  const [days, setDays] = useState('7')
  const { data, error, isLoading } = useSWR<AgentMetrics>(
    `/api/agent/metrics?days=${days}`,
    fetcher,
    { refreshInterval: 60_000, shouldRetryOnError: false },
  )

  const exportJsonl = () => {
    window.open(`/api/agent/export?days=${days}&format=jsonl`, '_blank')
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <Activity className="h-8 w-8 text-indigo-600" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Agent Run Metrics
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Aggregated performance and cost metrics for headless Claude agent runs (builder#57, Admin Only)
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-4 mb-6">
          <div className="flex items-center gap-2">
            <label htmlFor="days" className="text-sm font-medium text-gray-700 dark:text-gray-300">
              Window:
            </label>
            <Select value={days} onValueChange={setDays}>
              <SelectTrigger id="days" className="w-[140px]" data-testid="agent-metrics-days">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1">Last 24 hours</SelectItem>
                <SelectItem value="7">Last 7 days</SelectItem>
                <SelectItem value="30">Last 30 days</SelectItem>
                <SelectItem value="90">Last 90 days</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" onClick={exportJsonl} data-testid="agent-metrics-export">
            Export JSONL
          </Button>
        </div>

        {isLoading && (
          <div className="text-center py-12" data-testid="agent-metrics-loading">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-900 border-r-transparent dark:border-white"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">Loading agent metrics…</p>
          </div>
        )}

        {error && (
          <div className="text-center py-12" data-testid="agent-metrics-error">
            <p className="text-red-600 dark:text-red-400">
              Failed to load agent metrics. Admin access required.
            </p>
          </div>
        )}

        {data && (
          <div data-testid="agent-metrics-content">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4 mb-8">
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Total Runs</CardDescription>
                  <CardTitle className="text-2xl" data-testid="metric-total-runs">
                    {data.totalRuns}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Build Pass Rate</CardDescription>
                  <CardTitle className="text-2xl" data-testid="metric-pass-rate">
                    {pct(data.buildPassRate)}
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Avg Duration</CardDescription>
                  <CardTitle className="text-2xl" data-testid="metric-avg-duration">
                    {(data.avgDurationMs / 1000).toFixed(1)}s
                  </CardTitle>
                </CardHeader>
              </Card>
              <Card>
                <CardHeader className="pb-2">
                  <CardDescription>Cost / Generation</CardDescription>
                  <CardTitle className="text-2xl" data-testid="metric-cost-per-gen">
                    ${data.costPerGeneration.toFixed(4)}
                  </CardTitle>
                </CardHeader>
              </Card>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>Agent vs Fast-Path</CardTitle>
                <CardDescription>
                  Build-pass success rate, headless agent fallback vs the default fast-path generation
                </CardDescription>
              </CardHeader>
              <CardContent>
                <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <div>
                    <dt className="text-sm text-gray-500 dark:text-gray-400">Avg Turns</dt>
                    <dd className="text-lg font-semibold">{data.avgTurns}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500 dark:text-gray-400">Fallback Rate</dt>
                    <dd className="text-lg font-semibold">{pct(data.fallbackRate)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500 dark:text-gray-400">Fallback Success</dt>
                    <dd className="text-lg font-semibold">{pct(data.fallbackSuccessRate)}</dd>
                  </div>
                  <div>
                    <dt className="text-sm text-gray-500 dark:text-gray-400">vs Fast-Path</dt>
                    <dd className="text-lg font-semibold" data-testid="metric-improvement">
                      {data.comparisonVsFastPath.improvement}
                    </dd>
                  </div>
                </dl>
              </CardContent>
            </Card>
          </div>
        )}
      </div>
    </div>
  )
}

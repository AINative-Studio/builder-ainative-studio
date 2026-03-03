'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  LineChart,
  Line,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts'
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { AppHeader } from '@/components/shared/app-header'
import { TrendingUp, Activity, CheckCircle, Edit } from 'lucide-react'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function InsightsPage() {
  const [timeRange, setTimeRange] = useState('7d')
  const [groupBy, setGroupBy] = useState('promptVersion')

  const { data, isLoading, error } = useSWR(
    `/api/rlhf/insights?timeRange=${timeRange}&groupBy=${groupBy}`,
    fetcher,
    {
      refreshInterval: 30000, // Refresh every 30 seconds
    }
  )

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Quality Insights Dashboard
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Monitor AI generation quality metrics and user feedback
          </p>
        </div>

        {/* Filters */}
        <div className="flex flex-wrap gap-4 mb-6">
          <div className="flex items-center gap-2">
            <label
              htmlFor="timeRange"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Time Range:
            </label>
            <Select value={timeRange} onValueChange={setTimeRange}>
              <SelectTrigger id="timeRange" className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="1d">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
                <SelectItem value="30d">Last 30 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="groupBy"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Group By:
            </label>
            <Select value={groupBy} onValueChange={setGroupBy}>
              <SelectTrigger id="groupBy" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="promptVersion">Prompt Version</SelectItem>
                <SelectItem value="model">Model</SelectItem>
                <SelectItem value="template">Template</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-900 border-r-transparent dark:border-white"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Loading insights...
            </p>
          </div>
        )}

        {/* Error State */}
        {error && !isLoading && (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400 mb-4">
              Failed to load insights. The database tables may not be initialized yet.
            </p>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Please ensure the database schema is set up correctly.
            </p>
          </div>
        )}

        {/* Summary Cards - Show empty state if no data but also no error */}
        {!isLoading && !error && data && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 mb-8">
              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Average Rating
                  </CardTitle>
                  <TrendingUp className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.summary?.avgRating ? data.summary.avgRating.toFixed(1) : '0.0'}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    out of 5.0 stars
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Total Generations
                  </CardTitle>
                  <Activity className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.summary?.totalGenerations?.toLocaleString() || '0'}
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    in selected period
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    First-Pass Success
                  </CardTitle>
                  <CheckCircle className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.summary?.firstPassSuccessRate ? data.summary.firstPassSuccessRate.toFixed(1) : '0.0'}%
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    used without edits
                  </p>
                </CardContent>
              </Card>

              <Card>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium">
                    Edit Rate
                  </CardTitle>
                  <Edit className="h-4 w-4 text-gray-600 dark:text-gray-400" />
                </CardHeader>
                <CardContent>
                  <div className="text-2xl font-bold">
                    {data.summary?.editRate ? data.summary.editRate.toFixed(1) : '0.0'}%
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400">
                    required modifications
                  </p>
                </CardContent>
              </Card>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-8">
              {/* Rating Over Time Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Rating Trend</CardTitle>
                  <CardDescription>
                    Average rating over time
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <LineChart data={data.ratingOverTime}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis
                        dataKey="date"
                        tickFormatter={(value) => {
                          const date = new Date(value)
                          return `${date.getMonth() + 1}/${date.getDate()}`
                        }}
                      />
                      <YAxis domain={[0, 5]} />
                      <Tooltip
                        labelFormatter={(value) => {
                          const date = new Date(value as string)
                          return date.toLocaleDateString()
                        }}
                      />
                      <Legend />
                      <Line
                        type="monotone"
                        dataKey="avgRating"
                        stroke="#8884d8"
                        name="Avg Rating"
                        strokeWidth={2}
                      />
                    </LineChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>

              {/* Category Breakdown Chart */}
              <Card>
                <CardHeader>
                  <CardTitle>Category Performance</CardTitle>
                  <CardDescription>
                    Average rating by category
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ResponsiveContainer width="100%" height={300}>
                    <BarChart data={data.breakdown}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="category" angle={-45} textAnchor="end" height={80} />
                      <YAxis domain={[0, 5]} />
                      <Tooltip />
                      <Legend />
                      <Bar dataKey="avgRating" fill="#82ca9d" name="Avg Rating" />
                    </BarChart>
                  </ResponsiveContainer>
                </CardContent>
              </Card>
            </div>

            {/* Detailed Breakdown Table */}
            <Card>
              <CardHeader>
                <CardTitle>Detailed Breakdown</CardTitle>
                <CardDescription>
                  Performance metrics by category and configuration
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Category</TableHead>
                        <TableHead>Prompt Version</TableHead>
                        <TableHead>Model</TableHead>
                        <TableHead className="text-right">Avg Rating</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead className="text-right">Edit Rate</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.detailedBreakdown.map((row: any) => (
                        <TableRow key={row.id}>
                          <TableCell className="font-medium">
                            {row.category}
                          </TableCell>
                          <TableCell>{row.promptVersion}</TableCell>
                          <TableCell>{row.model}</TableCell>
                          <TableCell className="text-right">
                            {row.avgRating.toFixed(1)}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.count}
                          </TableCell>
                          <TableCell className="text-right">
                            {row.editRate}%
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </div>
  )
}

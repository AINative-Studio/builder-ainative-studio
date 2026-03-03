'use client'

import { useState, useEffect } from 'react'
import useSWR from 'swr'
import {
  LineChart,
  Line,
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
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { AppHeader } from '@/components/shared/app-header'
import { AlertCircle, ChevronDown, ChevronRight } from 'lucide-react'
import { Button } from '@/components/ui/button'

const fetcher = (url: string) => fetch(url).then((res) => res.json())

export default function ErrorMonitoringPage() {
  const [timeRange, setTimeRange] = useState('24h')
  const [errorType, setErrorType] = useState('all')
  const [endpoint, setEndpoint] = useState('all')
  const [expandedRows, setExpandedRows] = useState<Set<number>>(new Set())

  const { data, isLoading, error } = useSWR(
    () => {
      const params = new URLSearchParams({ timeRange })
      if (errorType !== 'all') params.append('errorType', errorType)
      if (endpoint !== 'all') params.append('endpoint', endpoint)
      return `/api/admin/errors?${params}`
    },
    fetcher,
    {
      refreshInterval: 30000, // Auto-refresh every 30 seconds
    }
  )

  const toggleRow = (id: number) => {
    const newExpandedRows = new Set(expandedRows)
    if (newExpandedRows.has(id)) {
      newExpandedRows.delete(id)
    } else {
      newExpandedRows.add(id)
    }
    setExpandedRows(newExpandedRows)
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />

      <div className="container mx-auto px-4 py-8">
        {/* Page Header */}
        <div className="mb-8">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle className="h-8 w-8 text-red-600" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
              Error Monitoring Dashboard
            </h1>
          </div>
          <p className="text-gray-600 dark:text-gray-400">
            Track and monitor application errors in real-time (Admin Only)
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
                <SelectItem value="1h">Last hour</SelectItem>
                <SelectItem value="24h">Last 24 hours</SelectItem>
                <SelectItem value="7d">Last 7 days</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="errorType"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Error Type:
            </label>
            <Select value={errorType} onValueChange={setErrorType}>
              <SelectTrigger id="errorType" className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="api">API Error</SelectItem>
                <SelectItem value="database">Database Error</SelectItem>
                <SelectItem value="validation">Validation Error</SelectItem>
                <SelectItem value="runtime">Runtime Error</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex items-center gap-2">
            <label
              htmlFor="endpoint"
              className="text-sm font-medium text-gray-700 dark:text-gray-300"
            >
              Endpoint:
            </label>
            <Select value={endpoint} onValueChange={setEndpoint}>
              <SelectTrigger id="endpoint" className="w-[180px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Endpoints</SelectItem>
                <SelectItem value="/api/chat-ws">/api/chat-ws</SelectItem>
                <SelectItem value="/api/chat">/api/chat</SelectItem>
                <SelectItem value="/api/chats">/api/chats</SelectItem>
                <SelectItem value="/api/preview">/api/preview</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="text-center py-12">
            <div className="inline-block h-8 w-8 animate-spin rounded-full border-4 border-solid border-gray-900 border-r-transparent dark:border-white"></div>
            <p className="mt-4 text-gray-600 dark:text-gray-400">
              Loading error data...
            </p>
          </div>
        )}

        {/* Error State */}
        {error && (
          <div className="text-center py-12">
            <p className="text-red-600 dark:text-red-400">
              Failed to load error data. Please try again.
            </p>
          </div>
        )}

        {/* Error Rate Chart */}
        {data && (
          <>
            <Card className="mb-8">
              <CardHeader>
                <CardTitle>Error Rate Over Time</CardTitle>
                <CardDescription>
                  Number of errors per hour (auto-refreshes every 30s)
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart data={data.statistics?.error_rate_by_hour || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis
                      dataKey="hour"
                      tickFormatter={(value) => {
                        const date = new Date(value)
                        return `${date.getHours()}:${String(date.getMinutes()).padStart(2, '0')}`
                      }}
                    />
                    <YAxis />
                    <Tooltip
                      labelFormatter={(value) => {
                        const date = new Date(value as string)
                        return date.toLocaleString()
                      }}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="count"
                      stroke="#8884d8"
                      name="Total"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="error_count"
                      stroke="#ff7300"
                      name="Errors"
                      strokeWidth={2}
                    />
                    <Line
                      type="monotone"
                      dataKey="fatal_count"
                      stroke="#ef4444"
                      name="Fatal"
                      strokeWidth={2}
                    />
                  </LineChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>

            {/* Error List Table */}
            <Card>
              <CardHeader>
                <CardTitle>Error Log</CardTitle>
                <CardDescription>
                  Click on a row to view stack trace details
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-[50px]"></TableHead>
                        <TableHead>Time</TableHead>
                        <TableHead>Type</TableHead>
                        <TableHead>Message</TableHead>
                        <TableHead className="text-right">Count</TableHead>
                        <TableHead>Endpoint</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {data.errors?.map((errorItem: any) => (
                        <>
                          <TableRow
                            key={errorItem.id}
                            className="cursor-pointer hover:bg-gray-100 dark:hover:bg-gray-900"
                            onClick={() => toggleRow(errorItem.id)}
                          >
                            <TableCell>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-6 w-6 p-0"
                              >
                                {expandedRows.has(errorItem.id) ? (
                                  <ChevronDown className="h-4 w-4" />
                                ) : (
                                  <ChevronRight className="h-4 w-4" />
                                )}
                              </Button>
                            </TableCell>
                            <TableCell>
                              {new Date(errorItem.timestamp).toLocaleString()}
                            </TableCell>
                            <TableCell>
                              <span
                                className={`inline-flex items-center rounded-full px-2 py-1 text-xs font-medium ${
                                  errorItem.level === 'fatal'
                                    ? 'bg-red-100 text-red-700 dark:bg-red-900 dark:text-red-300'
                                    : errorItem.level === 'error'
                                    ? 'bg-orange-100 text-orange-700 dark:bg-orange-900 dark:text-orange-300'
                                    : errorItem.level === 'warn'
                                    ? 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900 dark:text-yellow-300'
                                    : 'bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300'
                                }`}
                              >
                                {errorItem.error_type || errorItem.level}
                              </span>
                            </TableCell>
                            <TableCell className="max-w-md truncate">
                              {errorItem.message}
                            </TableCell>
                            <TableCell className="text-right">
                              <span className="inline-flex items-center justify-center rounded-full bg-gray-100 px-2 py-1 text-xs font-semibold text-gray-900 dark:bg-gray-800 dark:text-gray-100">
                                1
                              </span>
                            </TableCell>
                            <TableCell>
                              <code className="text-xs bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded">
                                {errorItem.endpoint || 'N/A'}
                              </code>
                            </TableCell>
                          </TableRow>
                          {expandedRows.has(errorItem.id) && (
                            <TableRow>
                              <TableCell colSpan={6} className="bg-gray-50 dark:bg-gray-900">
                                <div className="p-4 space-y-4">
                                  <div>
                                    <h4 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">
                                      Context:
                                    </h4>
                                    <pre className="text-xs bg-gray-100 dark:bg-gray-800 text-gray-900 dark:text-gray-100 p-4 rounded overflow-x-auto">
                                      {JSON.stringify(errorItem.context, null, 2)}
                                    </pre>
                                  </div>
                                  {errorItem.stack_trace && (
                                    <div>
                                      <h4 className="text-sm font-semibold mb-2 text-gray-900 dark:text-white">
                                        Stack Trace:
                                      </h4>
                                      <pre className="text-xs bg-gray-900 dark:bg-black text-gray-100 p-4 rounded overflow-x-auto">
                                        {errorItem.stack_trace}
                                      </pre>
                                    </div>
                                  )}
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </>
                      )) || []}
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

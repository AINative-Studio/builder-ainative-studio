'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow
} from '@/components/ui/table'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from '@/components/ui/select'
import { Input } from '@/components/ui/input'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { AppHeader } from '@/components/shared/app-header'
import {
  Cloud,
  Server,
  Rocket,
  ExternalLink,
  Search,
  RefreshCw,
  Loader2
} from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'

interface Deployment {
  id: string
  generationId: string
  platform: string
  url: string
  status: 'pending' | 'building' | 'ready' | 'error'
  createdAt: string
  error?: string
}

const platformIcons: Record<string, React.ReactNode> = {
  vercel: <Cloud className="w-4 h-4" />,
  netlify: <Cloud className="w-4 h-4" />,
  railway: <Server className="w-4 h-4" />,
  ainative: <Rocket className="w-4 h-4" />
}

const statusColors: Record<string, string> = {
  pending: 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-400',
  building: 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400',
  ready: 'bg-green-500/10 text-green-700 border-green-500/20 dark:text-green-400',
  error: 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400'
}

export default function DeploymentsPage() {
  const [deployments, setDeployments] = useState<Deployment[]>([])
  const [filteredDeployments, setFilteredDeployments] = useState<Deployment[]>([])
  const [loading, setLoading] = useState(true)
  const [platformFilter, setPlatformFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [searchQuery, setSearchQuery] = useState('')
  const [currentPage, setCurrentPage] = useState(1)
  const [refreshing, setRefreshing] = useState(false)
  const itemsPerPage = 20
  const router = useRouter()
  const { toast } = useToast()

  useEffect(() => {
    fetchDeployments()
    // Set up polling for real-time updates every 10 seconds
    const interval = setInterval(fetchDeployments, 10000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    // Apply filters
    let filtered = deployments

    if (platformFilter !== 'all') {
      filtered = filtered.filter((d) => d.platform === platformFilter)
    }

    if (statusFilter !== 'all') {
      filtered = filtered.filter((d) => d.status === statusFilter)
    }

    if (searchQuery) {
      filtered = filtered.filter((d) =>
        d.url.toLowerCase().includes(searchQuery.toLowerCase())
      )
    }

    setFilteredDeployments(filtered)
    setCurrentPage(1) // Reset to first page when filters change
  }, [deployments, platformFilter, statusFilter, searchQuery])

  const fetchDeployments = async (showRefreshIndicator = false) => {
    try {
      if (showRefreshIndicator) {
        setRefreshing(true)
      }

      const response = await fetch('/api/deployments')
      if (!response.ok) {
        throw new Error('Failed to fetch deployments')
      }

      const data = await response.json()
      setDeployments(data.deployments || [])
    } catch (error) {
      console.error('Error fetching deployments:', error)
      toast({
        title: 'Failed to load deployments',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive'
      })
    } finally {
      setLoading(false)
      if (showRefreshIndicator) {
        setRefreshing(false)
      }
    }
  }

  const handleRefresh = () => {
    fetchDeployments(true)
  }

  // Pagination
  const totalPages = Math.ceil(filteredDeployments.length / itemsPerPage)
  const startIndex = (currentPage - 1) * itemsPerPage
  const endIndex = startIndex + itemsPerPage
  const currentDeployments = filteredDeployments.slice(startIndex, endIndex)

  const uniquePlatforms = Array.from(new Set(deployments.map((d) => d.platform)))

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 dark:bg-black">
        <AppHeader />
        <div className="container mx-auto px-4 py-8">
          <div className="flex items-center justify-center h-64">
            <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />
      <div className="container mx-auto px-4 py-8">
        <div className="mb-6">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-2">
            Deployments
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            View and manage all your deployed applications
          </p>
        </div>

        <Card>
          <CardHeader>
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
              <div>
                <CardTitle>Deployment History</CardTitle>
                <CardDescription>
                  {filteredDeployments.length} deployment
                  {filteredDeployments.length !== 1 ? 's' : ''}
                </CardDescription>
              </div>
              <Button
                onClick={handleRefresh}
                variant="outline"
                size="sm"
                disabled={refreshing}
              >
                <RefreshCw
                  className={`w-4 h-4 mr-2 ${refreshing ? 'animate-spin' : ''}`}
                />
                Refresh
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {/* Filters */}
            <div className="flex flex-col sm:flex-row gap-4 mb-6">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <Input
                    placeholder="Search by URL..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>
              <Select value={platformFilter} onValueChange={setPlatformFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All platforms" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All platforms</SelectItem>
                  {uniquePlatforms.map((platform) => (
                    <SelectItem key={platform} value={platform}>
                      {platform.charAt(0).toUpperCase() + platform.slice(1)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="w-full sm:w-[180px]">
                  <SelectValue placeholder="All statuses" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="building">Building</SelectItem>
                  <SelectItem value="ready">Ready</SelectItem>
                  <SelectItem value="error">Error</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Table */}
            {currentDeployments.length === 0 ? (
              <div className="text-center py-12">
                <Rocket className="w-12 h-12 text-gray-400 mx-auto mb-4" />
                <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
                  No deployments found
                </h3>
                <p className="text-gray-600 dark:text-gray-400">
                  {searchQuery || platformFilter !== 'all' || statusFilter !== 'all'
                    ? 'Try adjusting your filters'
                    : 'Deploy your first project to get started'}
                </p>
              </div>
            ) : (
              <>
                <div className="rounded-lg border">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Platform</TableHead>
                        <TableHead>URL</TableHead>
                        <TableHead>Status</TableHead>
                        <TableHead>Date</TableHead>
                        <TableHead className="text-right">Actions</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {currentDeployments.map((deployment) => (
                        <TableRow key={deployment.id}>
                          <TableCell>
                            <div className="flex items-center gap-2">
                              {platformIcons[deployment.platform] || (
                                <Cloud className="w-4 h-4" />
                              )}
                              <span className="font-medium capitalize">
                                {deployment.platform}
                              </span>
                            </div>
                          </TableCell>
                          <TableCell>
                            <a
                              href={deployment.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="text-blue-600 hover:text-blue-700 dark:text-blue-400 dark:hover:text-blue-300 inline-flex items-center gap-1 group"
                            >
                              <span className="max-w-[300px] truncate">
                                {deployment.url}
                              </span>
                              <ExternalLink className="w-3 h-3 opacity-0 group-hover:opacity-100 transition-opacity" />
                            </a>
                          </TableCell>
                          <TableCell>
                            <Badge
                              variant="outline"
                              className={statusColors[deployment.status]}
                            >
                              {deployment.status === 'pending' && 'Pending'}
                              {deployment.status === 'building' && 'Building'}
                              {deployment.status === 'ready' && 'Ready'}
                              {deployment.status === 'error' && 'Error'}
                            </Badge>
                          </TableCell>
                          <TableCell>
                            {new Date(deployment.createdAt).toLocaleDateString(
                              'en-US',
                              {
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric',
                                hour: '2-digit',
                                minute: '2-digit'
                              }
                            )}
                          </TableCell>
                          <TableCell className="text-right">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => window.open(deployment.url, '_blank')}
                            >
                              <ExternalLink className="w-4 h-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>

                {/* Pagination */}
                {totalPages > 1 && (
                  <div className="flex items-center justify-between mt-4">
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Showing {startIndex + 1} to{' '}
                      {Math.min(endIndex, filteredDeployments.length)} of{' '}
                      {filteredDeployments.length} deployments
                    </p>
                    <div className="flex gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                        disabled={currentPage === 1}
                      >
                        Previous
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          setCurrentPage((p) => Math.min(totalPages, p + 1))
                        }
                        disabled={currentPage === totalPages}
                      >
                        Next
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

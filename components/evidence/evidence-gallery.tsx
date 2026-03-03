'use client'

/**
 * Evidence Gallery Component
 *
 * Displays a gallery of evidence with filtering, sorting, and detailed views.
 * Shows test runs, builds, coverage reports, and deployments.
 */

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardDescription, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import type { Evidence, EvidenceType, EvidenceStatus } from '@/lib/types/evidence'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  Code,
  TestTube,
  Package,
  Rocket,
  FileCode,
  Image,
  Search,
  Filter,
  Download,
  Eye,
} from 'lucide-react'

interface EvidenceGalleryProps {
  userId?: string
  projectId?: string
  gitBranch?: string
  onEvidenceSelect?: (evidence: Evidence) => void
}

export function EvidenceGallery({ userId, projectId, gitBranch, onEvidenceSelect }: EvidenceGalleryProps) {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [loading, setLoading] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [typeFilter, setTypeFilter] = useState<string>('all')
  const [statusFilter, setStatusFilter] = useState<string>('all')
  const [pagination, setPagination] = useState({ total: 0, limit: 20, offset: 0, hasMore: false })

  // Fetch evidence
  useEffect(() => {
    fetchEvidence()
  }, [typeFilter, statusFilter, pagination.offset])

  const fetchEvidence = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({
        limit: pagination.limit.toString(),
        offset: pagination.offset.toString(),
      })

      if (typeFilter !== 'all') params.set('type', typeFilter)
      if (statusFilter !== 'all') params.set('status', statusFilter)
      if (projectId) params.set('project_id', projectId)
      if (gitBranch) params.set('git_branch', gitBranch)
      if (searchQuery) params.set('search', searchQuery)

      const response = await fetch(`/api/evidence?${params}`)
      const data = await response.json()

      setEvidence(data.evidence || [])
      setPagination(data.pagination || { total: 0, limit: 20, offset: 0, hasMore: false })
    } catch (error) {
      console.error('Failed to fetch evidence:', error)
    } finally {
      setLoading(false)
    }
  }

  const handleSearch = () => {
    setPagination((prev) => ({ ...prev, offset: 0 }))
    fetchEvidence()
  }

  const getStatusIcon = (status: EvidenceStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-4 w-4 text-green-500" />
      case 'failure':
        return <XCircle className="h-4 w-4 text-red-500" />
      case 'warning':
        return <AlertTriangle className="h-4 w-4 text-yellow-500" />
      case 'pending':
        return <Clock className="h-4 w-4 text-gray-500" />
      default:
        return <Clock className="h-4 w-4 text-gray-500" />
    }
  }

  const getTypeIcon = (type: EvidenceType) => {
    switch (type) {
      case 'test-run':
        return <TestTube className="h-4 w-4" />
      case 'build':
        return <Package className="h-4 w-4" />
      case 'coverage':
        return <FileCode className="h-4 w-4" />
      case 'deployment':
        return <Rocket className="h-4 w-4" />
      case 'screenshot':
        return <Image className="h-4 w-4" />
      default:
        return <Code className="h-4 w-4" />
    }
  }

  const getStatusColor = (status: EvidenceStatus) => {
    switch (status) {
      case 'success':
        return 'bg-green-500/10 text-green-500 border-green-500/20'
      case 'failure':
        return 'bg-red-500/10 text-red-500 border-red-500/20'
      case 'warning':
        return 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20'
      case 'pending':
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
      default:
        return 'bg-gray-500/10 text-gray-500 border-gray-500/20'
    }
  }

  const formatDate = (date: Date) => {
    return new Date(date).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const formatDuration = (ms?: number) => {
    if (!ms) return 'N/A'
    if (ms < 1000) return `${ms}ms`
    if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
    return `${(ms / 60000).toFixed(1)}m`
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="p-4 border-b">
        <h2 className="text-2xl font-bold mb-4">Evidence Gallery</h2>

        {/* Filters */}
        <div className="flex gap-2 mb-4">
          <div className="flex-1 relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search evidence..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
              className="pl-9"
            />
          </div>
          <Button onClick={handleSearch} variant="secondary">
            <Search className="h-4 w-4 mr-2" />
            Search
          </Button>
        </div>

        <div className="flex gap-2">
          <Select value={typeFilter} onValueChange={setTypeFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Type" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Types</SelectItem>
              <SelectItem value="test-run">Test Runs</SelectItem>
              <SelectItem value="coverage">Coverage</SelectItem>
              <SelectItem value="build">Builds</SelectItem>
              <SelectItem value="deployment">Deployments</SelectItem>
              <SelectItem value="lint">Lint</SelectItem>
              <SelectItem value="type-check">Type Check</SelectItem>
            </SelectContent>
          </Select>

          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="h-4 w-4 mr-2" />
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="success">Success</SelectItem>
              <SelectItem value="failure">Failure</SelectItem>
              <SelectItem value="warning">Warning</SelectItem>
              <SelectItem value="pending">Pending</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Evidence Grid */}
      <ScrollArea className="flex-1">
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted-foreground">Loading evidence...</div>
            </div>
          ) : evidence.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <TestTube className="h-12 w-12 mb-4 opacity-50" />
              <p>No evidence found</p>
              <p className="text-sm">Try adjusting your filters or run some tests!</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {evidence.map((item) => (
                <Card key={item.id} className="hover:shadow-lg transition-shadow cursor-pointer">
                  <CardHeader>
                    <div className="flex items-start justify-between mb-2">
                      <div className="flex items-center gap-2">
                        {getTypeIcon(item.type)}
                        <Badge variant="outline" className="text-xs">
                          {item.type}
                        </Badge>
                      </div>
                      <div className="flex items-center gap-1">
                        {getStatusIcon(item.status)}
                        <Badge variant="outline" className={`text-xs ${getStatusColor(item.status)}`}>
                          {item.status}
                        </Badge>
                      </div>
                    </div>
                    <CardTitle className="text-base line-clamp-2">{item.title}</CardTitle>
                    <CardDescription className="text-xs">{formatDate(item.created_at)}</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {/* Metadata Summary */}
                    <div className="space-y-2 mb-4">
                      {item.metadata.coveragePercent && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Coverage:</span>
                          <span className="font-medium">{item.metadata.coveragePercent.toFixed(1)}%</span>
                        </div>
                      )}
                      {item.metadata.testsPassed !== undefined && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Tests:</span>
                          <span className="font-medium">
                            {item.metadata.testsPassed} / {item.metadata.totalTests || 0}
                          </span>
                        </div>
                      )}
                      {item.metadata.executionDuration && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Duration:</span>
                          <span className="font-medium">{formatDuration(item.metadata.executionDuration)}</span>
                        </div>
                      )}
                      {item.git_branch && (
                        <div className="flex justify-between text-sm">
                          <span className="text-muted-foreground">Branch:</span>
                          <span className="font-mono text-xs">{item.git_branch}</span>
                        </div>
                      )}
                    </div>

                    <Separator className="my-3" />

                    {/* Actions */}
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        className="flex-1"
                        onClick={() => onEvidenceSelect?.(item)}
                      >
                        <Eye className="h-3 w-3 mr-1" />
                        View
                      </Button>
                      <Button size="sm" variant="ghost">
                        <Download className="h-3 w-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          )}

          {/* Pagination */}
          {pagination.total > pagination.limit && (
            <div className="flex items-center justify-between mt-6">
              <div className="text-sm text-muted-foreground">
                Showing {pagination.offset + 1} - {Math.min(pagination.offset + pagination.limit, pagination.total)} of{' '}
                {pagination.total}
              </div>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  disabled={pagination.offset === 0}
                  onClick={() => setPagination((prev) => ({ ...prev, offset: prev.offset - prev.limit }))}
                >
                  Previous
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  disabled={!pagination.hasMore}
                  onClick={() => setPagination((prev) => ({ ...prev, offset: prev.offset + prev.limit }))}
                >
                  Next
                </Button>
              </div>
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

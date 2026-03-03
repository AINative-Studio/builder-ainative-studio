'use client'

/**
 * Evidence Timeline Component
 *
 * Displays evidence in a chronological timeline view
 * with expandable details and metadata visualization.
 */

import { useState, useEffect } from 'react'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Separator } from '@/components/ui/separator'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import type { Evidence, EvidenceType, EvidenceStatus } from '@/lib/types/evidence'
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Clock,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  GitBranch,
  GitCommit,
  Timer,
} from 'lucide-react'

interface EvidenceTimelineProps {
  userId?: string
  projectId?: string
  gitBranch?: string
  limit?: number
}

export function EvidenceTimeline({ userId, projectId, gitBranch, limit = 50 }: EvidenceTimelineProps) {
  const [evidence, setEvidence] = useState<Evidence[]>([])
  const [loading, setLoading] = useState(true)
  const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set())

  useEffect(() => {
    fetchEvidence()
  }, [projectId, gitBranch])

  const fetchEvidence = async () => {
    try {
      setLoading(true)
      const params = new URLSearchParams({ limit: limit.toString() })

      if (projectId) params.set('project_id', projectId)
      if (gitBranch) params.set('git_branch', gitBranch)

      const response = await fetch(`/api/evidence?${params}`)
      const data = await response.json()

      setEvidence(data.evidence || [])
    } catch (error) {
      console.error('Failed to fetch evidence:', error)
    } finally {
      setLoading(false)
    }
  }

  const toggleExpanded = (id: string) => {
    setExpandedItems((prev) => {
      const next = new Set(prev)
      if (next.has(id)) {
        next.delete(id)
      } else {
        next.add(id)
      }
      return next
    })
  }

  const getStatusIcon = (status: EvidenceStatus) => {
    switch (status) {
      case 'success':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case 'failure':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />
      case 'pending':
        return <Clock className="h-5 w-5 text-gray-500" />
      default:
        return <Clock className="h-5 w-5 text-gray-500" />
    }
  }

  const getStatusColor = (status: EvidenceStatus) => {
    switch (status) {
      case 'success':
        return 'border-green-500'
      case 'failure':
        return 'border-red-500'
      case 'warning':
        return 'border-yellow-500'
      case 'pending':
        return 'border-gray-500'
      default:
        return 'border-gray-500'
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

  // Group evidence by date
  const groupedEvidence = evidence.reduce((groups, item) => {
    const date = new Date(item.created_at).toLocaleDateString('en-US', {
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    })
    if (!groups[date]) {
      groups[date] = []
    }
    groups[date].push(item)
    return groups
  }, {} as Record<string, Evidence[]>)

  return (
    <div className="flex flex-col h-full">
      <div className="p-4 border-b">
        <h2 className="text-2xl font-bold">Evidence Timeline</h2>
        <p className="text-sm text-muted-foreground mt-1">Chronological history of test runs, builds, and deployments</p>
      </div>

      <ScrollArea className="flex-1">
        <div className="p-4">
          {loading ? (
            <div className="flex items-center justify-center h-64">
              <div className="text-muted-foreground">Loading timeline...</div>
            </div>
          ) : evidence.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-64 text-muted-foreground">
              <Clock className="h-12 w-12 mb-4 opacity-50" />
              <p>No evidence yet</p>
              <p className="text-sm">Evidence will appear here as you run tests and builds</p>
            </div>
          ) : (
            <div className="space-y-8">
              {Object.entries(groupedEvidence).map(([date, items]) => (
                <div key={date}>
                  <h3 className="text-sm font-semibold text-muted-foreground mb-4">{date}</h3>
                  <div className="space-y-4">
                    {items.map((item, index) => (
                      <div key={item.id} className="relative">
                        {/* Timeline line */}
                        {index < items.length - 1 && (
                          <div className="absolute left-[21px] top-12 bottom-0 w-px bg-border" />
                        )}

                        <Card className={`border-l-4 ${getStatusColor(item.status)}`}>
                          <Collapsible open={expandedItems.has(item.id)} onOpenChange={() => toggleExpanded(item.id)}>
                            <CollapsibleTrigger asChild>
                              <CardHeader className="cursor-pointer hover:bg-muted/50 transition-colors">
                                <div className="flex items-start gap-4">
                                  <div className="mt-1">{getStatusIcon(item.status)}</div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-start justify-between gap-2">
                                      <CardTitle className="text-base">{item.title}</CardTitle>
                                      <div className="flex items-center gap-2 flex-shrink-0">
                                        <Badge variant="outline" className="text-xs">
                                          {item.type}
                                        </Badge>
                                        {expandedItems.has(item.id) ? (
                                          <ChevronDown className="h-4 w-4" />
                                        ) : (
                                          <ChevronRight className="h-4 w-4" />
                                        )}
                                      </div>
                                    </div>
                                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                                      <span className="flex items-center gap-1">
                                        <Clock className="h-3 w-3" />
                                        {formatDate(item.created_at)}
                                      </span>
                                      {item.metadata.executionDuration && (
                                        <span className="flex items-center gap-1">
                                          <Timer className="h-3 w-3" />
                                          {formatDuration(item.metadata.executionDuration)}
                                        </span>
                                      )}
                                      {item.git_branch && (
                                        <span className="flex items-center gap-1">
                                          <GitBranch className="h-3 w-3" />
                                          {item.git_branch}
                                        </span>
                                      )}
                                    </div>
                                  </div>
                                </div>
                              </CardHeader>
                            </CollapsibleTrigger>

                            <CollapsibleContent>
                              <CardContent className="pt-0">
                                <Separator className="mb-4" />

                                {/* Metadata Grid */}
                                <div className="grid grid-cols-2 gap-3 mb-4">
                                  {item.metadata.coveragePercent && (
                                    <div>
                                      <div className="text-xs text-muted-foreground">Coverage</div>
                                      <div className="text-sm font-medium">{item.metadata.coveragePercent.toFixed(1)}%</div>
                                    </div>
                                  )}
                                  {item.metadata.testsPassed !== undefined && (
                                    <div>
                                      <div className="text-xs text-muted-foreground">Tests Passed</div>
                                      <div className="text-sm font-medium">
                                        {item.metadata.testsPassed} / {item.metadata.totalTests || 0}
                                      </div>
                                    </div>
                                  )}
                                  {item.metadata.testsFailed !== undefined && item.metadata.testsFailed > 0 && (
                                    <div>
                                      <div className="text-xs text-muted-foreground">Tests Failed</div>
                                      <div className="text-sm font-medium text-red-500">{item.metadata.testsFailed}</div>
                                    </div>
                                  )}
                                  {item.metadata.buildSuccess !== undefined && (
                                    <div>
                                      <div className="text-xs text-muted-foreground">Build Status</div>
                                      <div className="text-sm font-medium">
                                        {item.metadata.buildSuccess ? (
                                          <span className="text-green-500">Success</span>
                                        ) : (
                                          <span className="text-red-500">Failed</span>
                                        )}
                                      </div>
                                    </div>
                                  )}
                                  {item.metadata.buildErrors !== undefined && item.metadata.buildErrors > 0 && (
                                    <div>
                                      <div className="text-xs text-muted-foreground">Build Errors</div>
                                      <div className="text-sm font-medium text-red-500">{item.metadata.buildErrors}</div>
                                    </div>
                                  )}
                                  {item.git_commit && (
                                    <div>
                                      <div className="text-xs text-muted-foreground">Commit</div>
                                      <div className="text-sm font-mono">{item.git_commit.substring(0, 8)}</div>
                                    </div>
                                  )}
                                </div>

                                {/* Command */}
                                {item.command && (
                                  <div className="mb-4">
                                    <div className="text-xs text-muted-foreground mb-1">Command</div>
                                    <code className="text-xs bg-muted px-2 py-1 rounded block overflow-x-auto">
                                      {item.command}
                                    </code>
                                  </div>
                                )}

                                {/* Actions */}
                                <div className="flex gap-2">
                                  <Button size="sm" variant="outline">
                                    <ExternalLink className="h-3 w-3 mr-2" />
                                    View Details
                                  </Button>
                                  <Button size="sm" variant="outline">
                                    <Download className="h-3 w-3 mr-2" />
                                    Artifacts
                                  </Button>
                                </div>
                              </CardContent>
                            </CollapsibleContent>
                          </Collapsible>
                        </Card>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </ScrollArea>
    </div>
  )
}

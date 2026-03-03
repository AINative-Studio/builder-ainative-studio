"use client"

/**
 * Command Progress Tracker Component
 *
 * Real-time progress tracking for command execution
 *
 * Features:
 * - Checkpoint visualization
 * - Real-time status updates
 * - Evidence attachment
 * - Execution logs
 * - Error handling
 */

import * as React from 'react'
import { useState, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Progress } from '@/components/ui/progress'
import { Badge } from '@/components/ui/badge'
import { ScrollArea } from '@/components/ui/scroll-area'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  CheckCircle2,
  Circle,
  XCircle,
  Loader2,
  AlertCircle,
  Clock,
  ChevronDown,
  ChevronUp,
} from 'lucide-react'
import { AgentCommand, CheckpointState } from '@/lib/types/agent-commands'
import { cn } from '@/lib/utils'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'

interface CommandProgressTrackerProps {
  command: AgentCommand
  open: boolean
  onOpenChange: (open: boolean) => void
  onCancel?: () => void
}

export function CommandProgressTracker({
  command,
  open,
  onOpenChange,
  onCancel,
}: CommandProgressTrackerProps) {
  const [checkpointStates, setCheckpointStates] = useState<CheckpointState[]>(
    command.checkpoints.map((checkpoint) => ({
      checkpointId: checkpoint.id,
      status: 'pending',
    }))
  )
  const [currentCheckpointIndex, setCurrentCheckpointIndex] = useState(0)
  const [logs, setLogs] = useState<Array<{ timestamp: Date; level: string; message: string }>>([])
  const [expandedLogs, setExpandedLogs] = useState(false)

  // Simulate progress (in real implementation, this would be driven by WebSocket or polling)
  useEffect(() => {
    if (!open) return

    const interval = setInterval(() => {
      setCheckpointStates((prev) => {
        const updated = [...prev]
        const current = prev[currentCheckpointIndex]

        if (current && current.status === 'pending') {
          updated[currentCheckpointIndex] = {
            ...current,
            status: 'running',
            startedAt: new Date(),
          }
        } else if (current && current.status === 'running') {
          updated[currentCheckpointIndex] = {
            ...current,
            status: 'completed',
            completedAt: new Date(),
          }

          // Move to next checkpoint
          if (currentCheckpointIndex < command.checkpoints.length - 1) {
            setCurrentCheckpointIndex((prev) => prev + 1)
          }
        }

        return updated
      })
    }, 2000)

    return () => clearInterval(interval)
  }, [open, currentCheckpointIndex, command.checkpoints.length])

  const progressPercentage = Math.round(
    (checkpointStates.filter((s) => s.status === 'completed').length / command.checkpoints.length) * 100
  )

  const isComplete = checkpointStates.every((s) => s.status === 'completed')
  const hasFailed = checkpointStates.some((s) => s.status === 'failed')

  const getCheckpointIcon = (status: CheckpointState['status']) => {
    switch (status) {
      case 'completed':
        return <CheckCircle2 className="h-5 w-5 text-green-500" />
      case 'running':
        return <Loader2 className="h-5 w-5 text-blue-500 animate-spin" />
      case 'failed':
        return <XCircle className="h-5 w-5 text-red-500" />
      case 'skipped':
        return <Circle className="h-5 w-5 text-gray-400" />
      default:
        return <Circle className="h-5 w-5 text-gray-300" />
    }
  }

  const getStatusBadge = (status: CheckpointState['status']) => {
    const variants: Record<CheckpointState['status'], { variant: any; label: string }> = {
      pending: { variant: 'outline', label: 'Pending' },
      running: { variant: 'default', label: 'Running' },
      completed: { variant: 'default', label: 'Completed' },
      failed: { variant: 'destructive', label: 'Failed' },
      skipped: { variant: 'secondary', label: 'Skipped' },
    }

    const config = variants[status]
    return <Badge variant={config.variant}>{config.label}</Badge>
  }

  const formatDuration = (start?: Date, end?: Date) => {
    if (!start) return '-'
    const duration = end ? end.getTime() - start.getTime() : Date.now() - start.getTime()
    return `${Math.round(duration / 1000)}s`
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[700px] max-h-[80vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle>Executing: {command.metadata.name}</DialogTitle>
          <DialogDescription>
            {isComplete
              ? 'Command execution completed'
              : hasFailed
              ? 'Command execution failed'
              : 'Tracking command progress...'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 flex-1 overflow-hidden flex flex-col">
          {/* Overall Progress */}
          <div className="space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Progress</span>
              <span className="font-medium">{progressPercentage}%</span>
            </div>
            <Progress value={progressPercentage} className="h-2" />
          </div>

          {/* Status Summary */}
          <div className="flex gap-2">
            {isComplete && (
              <Alert>
                <CheckCircle2 className="h-4 w-4" />
                <AlertTitle>Success</AlertTitle>
                <AlertDescription>
                  All checkpoints completed successfully
                </AlertDescription>
              </Alert>
            )}
            {hasFailed && (
              <Alert variant="destructive">
                <XCircle className="h-4 w-4" />
                <AlertTitle>Error</AlertTitle>
                <AlertDescription>
                  Command execution failed at checkpoint{' '}
                  {command.checkpoints[
                    checkpointStates.findIndex((s) => s.status === 'failed')
                  ]?.title}
                </AlertDescription>
              </Alert>
            )}
          </div>

          {/* Checkpoints */}
          <ScrollArea className="flex-1 pr-4">
            <div className="space-y-3">
              {command.checkpoints.map((checkpoint, index) => {
                const state = checkpointStates[index]
                const isCurrent = index === currentCheckpointIndex

                return (
                  <div
                    key={checkpoint.id}
                    className={cn(
                      'border rounded-lg p-4 transition-all',
                      isCurrent && state.status === 'running' && 'border-blue-500 bg-blue-50 dark:bg-blue-950',
                      state.status === 'completed' && 'border-green-500',
                      state.status === 'failed' && 'border-red-500'
                    )}
                  >
                    <div className="flex items-start gap-3">
                      <div className="flex-shrink-0 mt-1">
                        {getCheckpointIcon(state.status)}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center justify-between gap-2">
                          <h4 className="font-medium truncate">{checkpoint.title}</h4>
                          <div className="flex items-center gap-2">
                            {state.startedAt && (
                              <span className="text-xs text-muted-foreground flex items-center gap-1">
                                <Clock className="h-3 w-3" />
                                {formatDuration(state.startedAt, state.completedAt)}
                              </span>
                            )}
                            {getStatusBadge(state.status)}
                          </div>
                        </div>
                        {checkpoint.description && (
                          <p className="text-sm text-muted-foreground mt-1">
                            {checkpoint.description}
                          </p>
                        )}
                        {state.error && (
                          <Alert variant="destructive" className="mt-2">
                            <AlertCircle className="h-4 w-4" />
                            <AlertDescription>{state.error}</AlertDescription>
                          </Alert>
                        )}
                        {state.notes && (
                          <p className="text-sm text-muted-foreground mt-2 italic">
                            Note: {state.notes}
                          </p>
                        )}
                        {checkpoint.type === 'evidence' && state.evidence && state.evidence.length > 0 && (
                          <div className="mt-2 space-y-1">
                            <p className="text-xs font-medium">Evidence:</p>
                            {state.evidence.map((ev, i) => (
                              <Badge key={i} variant="outline" className="text-xs">
                                {ev.type}: {ev.data.substring(0, 50)}...
                              </Badge>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                )
              })}
            </div>
          </ScrollArea>

          {/* Execution Logs */}
          {logs.length > 0 && (
            <Collapsible open={expandedLogs} onOpenChange={setExpandedLogs}>
              <CollapsibleTrigger asChild>
                <Button variant="outline" size="sm" className="w-full">
                  {expandedLogs ? (
                    <>
                      <ChevronUp className="h-4 w-4 mr-2" />
                      Hide Logs
                    </>
                  ) : (
                    <>
                      <ChevronDown className="h-4 w-4 mr-2" />
                      Show Logs ({logs.length})
                    </>
                  )}
                </Button>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <ScrollArea className="h-32 w-full rounded-md border p-2 mt-2">
                  <div className="space-y-1">
                    {logs.map((log, i) => (
                      <div key={i} className="text-xs font-mono flex gap-2">
                        <span className="text-muted-foreground">
                          {log.timestamp.toLocaleTimeString()}
                        </span>
                        <span
                          className={cn(
                            log.level === 'error' && 'text-red-500',
                            log.level === 'warning' && 'text-yellow-500',
                            log.level === 'info' && 'text-blue-500'
                          )}
                        >
                          [{log.level.toUpperCase()}]
                        </span>
                        <span>{log.message}</span>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </CollapsibleContent>
            </Collapsible>
          )}

          {/* Actions */}
          <div className="flex justify-end gap-2 border-t pt-4">
            {!isComplete && !hasFailed && onCancel && (
              <Button variant="outline" onClick={onCancel}>
                Cancel
              </Button>
            )}
            {(isComplete || hasFailed) && (
              <Button onClick={() => onOpenChange(false)}>Close</Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}

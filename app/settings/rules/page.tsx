'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { AppHeader } from '@/components/shared/app-header'
import { EnforcementDashboard } from '@/components/enforcement/enforcement-dashboard'
import { Loader2, ShieldCheck, PlayCircle } from 'lucide-react'
import { useToast } from '@/components/ui/use-toast'
import type {
  EnforcementReport,
  RuleContext,
  RuleViolation,
} from '@/lib/types/enforcement-rules'

interface RuleRow {
  id: string
  name: string
  description: string
  level: string
  category: string
  contexts: string[]
  enabled: boolean
}

const VALIDATION_CONTEXTS: { value: RuleContext; label: string }[] = [
  { value: 'commit', label: 'Commit' },
  { value: 'file-create', label: 'Create file' },
  { value: 'file-edit', label: 'Edit file' },
  { value: 'pr-create', label: 'Open PR' },
  { value: 'branch-create', label: 'Create branch' },
]

const levelBadgeClass = (level: string) => {
  switch (level) {
    case 'error':
      return 'bg-red-500/10 text-red-700 border-red-500/20 dark:text-red-400'
    case 'warning':
      return 'bg-yellow-500/10 text-yellow-700 border-yellow-500/20 dark:text-yellow-400'
    default:
      return 'bg-blue-500/10 text-blue-700 border-blue-500/20 dark:text-blue-400'
  }
}

export default function RulesSettingsPage() {
  const { toast } = useToast()
  const [rules, setRules] = useState<RuleRow[]>([])
  const [loading, setLoading] = useState(true)

  // Validation playground state
  const [context, setContext] = useState<RuleContext>('commit')
  const [commitMessage, setCommitMessage] = useState(
    'feat(auth): add login\n\nGenerated with Claude'
  )
  const [filePath, setFilePath] = useState('SUMMARY.md')
  const [fileContent, setFileContent] = useState('')
  const [report, setReport] = useState<EnforcementReport | null>(null)
  const [validating, setValidating] = useState(false)

  const fetchRules = useCallback(async () => {
    try {
      setLoading(true)
      const res = await fetch('/api/rules')
      if (!res.ok) throw new Error('Failed to load rules')
      const data = await res.json()
      setRules(data.rules || [])
    } catch (error) {
      toast({
        title: 'Failed to load rules',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }, [toast])

  useEffect(() => {
    fetchRules()
  }, [fetchRules])

  const toggleRule = async (rule: RuleRow) => {
    // Optimistic update.
    setRules((prev) =>
      prev.map((r) =>
        r.id === rule.id ? { ...r, enabled: !r.enabled } : r
      )
    )
    try {
      const res = await fetch(`/api/rules/${encodeURIComponent(rule.id)}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled: !rule.enabled }),
      })
      if (!res.ok) throw new Error('Update failed')
    } catch (error) {
      // Revert on failure.
      setRules((prev) =>
        prev.map((r) =>
          r.id === rule.id ? { ...r, enabled: rule.enabled } : r
        )
      )
      toast({
        title: 'Could not update rule',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const buildActionData = () => {
    switch (context) {
      case 'commit':
      case 'pr-create':
        return {
          commitMessage,
          prTitle: commitMessage.split('\n')[0],
          prDescription: commitMessage,
          files: fileContent ? [filePath] : undefined,
        }
      case 'file-create':
      case 'file-edit':
        return { filePath, fileContent }
      case 'branch-create':
        return { branch: filePath }
      default:
        return {}
    }
  }

  const runValidation = async () => {
    setValidating(true)
    setReport(null)
    try {
      const res = await fetch('/api/rules/validate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: context,
          data: buildActionData(),
          userId: 'playground',
          projectId: 'playground',
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Validation failed')

      // Rebuild an EnforcementReport shape from the API summary for the dashboard.
      const violations: RuleViolation[] = data.report.violations || []
      const grouped = new Map<string, RuleViolation[]>()
      for (const v of violations) {
        grouped.set(v.ruleId, [...(grouped.get(v.ruleId) || []), v])
      }
      setReport({
        action: {
          type: context,
          data: buildActionData(),
          userId: 'playground',
          projectId: 'playground',
          timestamp: new Date(),
        },
        results: Array.from(grouped.entries()).map(([ruleId, vs]) => ({
          ruleId,
          passed: false,
          violations: vs,
          duration: 0,
        })),
        passed: data.report.passed,
        errorCount: data.report.errorCount,
        warningCount: data.report.warningCount,
        infoCount: data.report.infoCount,
        totalDuration: data.report.totalDuration,
        timestamp: new Date(),
        canAutoFix: data.report.canAutoFix,
        suggestions: data.report.suggestions || [],
      })
    } catch (error) {
      toast({
        title: 'Validation failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    } finally {
      setValidating(false)
    }
  }

  const applyFixes = async () => {
    if (!report) return
    const violations = report.results.flatMap((r) => r.violations)
    try {
      const res = await fetch('/api/rules/auto-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: {
            type: context,
            data: buildActionData(),
            userId: 'playground',
            projectId: 'playground',
          },
          violations,
        }),
      })
      const data = await res.json()
      if (!data.success) throw new Error(data.error || 'Auto-fix failed')

      // Reflect fixes back into the editor and re-validate.
      const fixed = data.action?.data || {}
      if (typeof fixed.commitMessage === 'string')
        setCommitMessage(fixed.commitMessage)
      if (typeof fixed.fileContent === 'string')
        setFileContent(fixed.fileContent)

      toast({
        title: 'Auto-fix applied',
        description: `Fixed ${data.fixedCount} violation(s)`,
      })
      await runValidation()
    } catch (error) {
      toast({
        title: 'Auto-fix failed',
        description: error instanceof Error ? error.message : 'Unknown error',
        variant: 'destructive',
      })
    }
  }

  const usesContent =
    context === 'file-create' || context === 'file-edit'
  const usesMessage = context === 'commit' || context === 'pr-create'

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />
      <div className="container mx-auto max-w-5xl px-4 py-8">
        <div className="mb-6">
          <h1 className="mb-2 flex items-center gap-2 text-3xl font-bold text-gray-900 dark:text-white">
            <ShieldCheck className="h-7 w-7 text-emerald-600" />
            Rule Enforcement
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Pre-flight checks that block standards violations before they ship.
            Toggle rules and test actions against them below.
          </p>
        </div>

        {/* Validation playground */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <PlayCircle className="h-5 w-5" /> Validation Playground
            </CardTitle>
            <CardDescription>
              Run an action through the enforcement engine and preview
              violations with one-click auto-fix.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label>Action type</Label>
                <Select
                  value={context}
                  onValueChange={(v) => setContext(v as RuleContext)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {VALIDATION_CONTEXTS.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {(usesContent || context === 'branch-create') && (
                <div className="space-y-2">
                  <Label>
                    {context === 'branch-create' ? 'Branch name' : 'File path'}
                  </Label>
                  <input
                    className="w-full rounded-md border bg-transparent px-3 py-2 text-sm"
                    value={filePath}
                    onChange={(e) => setFilePath(e.target.value)}
                  />
                </div>
              )}
            </div>

            {usesMessage && (
              <div className="space-y-2">
                <Label>Commit / PR message</Label>
                <Textarea
                  rows={4}
                  value={commitMessage}
                  onChange={(e) => setCommitMessage(e.target.value)}
                />
              </div>
            )}

            {usesContent && (
              <div className="space-y-2">
                <Label>File content</Label>
                <Textarea
                  rows={4}
                  value={fileContent}
                  onChange={(e) => setFileContent(e.target.value)}
                  placeholder='const API_KEY = "sk_live_..."'
                />
              </div>
            )}

            <Button onClick={runValidation} disabled={validating}>
              {validating ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Validating...
                </>
              ) : (
                <>
                  <PlayCircle className="mr-2 h-4 w-4" />
                  Validate action
                </>
              )}
            </Button>
          </CardContent>
        </Card>

        {report && (
          <div className="mb-8">
            <EnforcementDashboard
              report={report}
              onApplyFixes={report.canAutoFix ? applyFixes : undefined}
            />
          </div>
        )}

        {/* Rules table */}
        <Card>
          <CardHeader>
            <CardTitle>Enforcement Rules</CardTitle>
            <CardDescription>
              {loading
                ? 'Loading rules...'
                : `${rules.length} rule${rules.length !== 1 ? 's' : ''} configured`}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {loading ? (
              <div className="flex h-40 items-center justify-center">
                <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
              </div>
            ) : rules.length === 0 ? (
              <div className="py-12 text-center text-gray-500 dark:text-gray-400">
                No rules found. Built-in rules are seeded on first run.
              </div>
            ) : (
              <div className="rounded-lg border">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Rule</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Level</TableHead>
                      <TableHead>Contexts</TableHead>
                      <TableHead className="text-right">Enabled</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {rules.map((rule) => (
                      <TableRow key={rule.id}>
                        <TableCell>
                          <div className="font-medium">{rule.name}</div>
                          <code className="text-xs text-muted-foreground">
                            {rule.id}
                          </code>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{rule.category}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="outline"
                            className={levelBadgeClass(rule.level)}
                          >
                            {rule.level}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <span className="text-xs text-muted-foreground">
                            {(rule.contexts || []).join(', ')}
                          </span>
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            variant={rule.enabled ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => toggleRule(rule)}
                          >
                            {rule.enabled ? 'On' : 'Off'}
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  )
}

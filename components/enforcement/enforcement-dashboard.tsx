/**
 * Enforcement Dashboard Component
 * Shows enforcement report summary with actions
 */

'use client';

import React, { useState } from 'react';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  CardFooter,
} from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Alert, AlertDescription } from '@/components/ui/alert';
import {
  CheckCircle2,
  XCircle,
  AlertTriangle,
  Info,
  Wrench,
  Clock,
} from 'lucide-react';
import { RuleViolationList } from './rule-violation-list';
import type { EnforcementReport } from '@/lib/types/enforcement-rules';

interface EnforcementDashboardProps {
  report: EnforcementReport;
  onApplyFixes?: () => Promise<void>;
  onIgnoreAll?: () => void;
}

export function EnforcementDashboard({
  report,
  onApplyFixes,
  onIgnoreAll,
}: EnforcementDashboardProps) {
  const [isApplyingFixes, setIsApplyingFixes] = useState(false);

  const handleApplyFixes = async () => {
    if (!onApplyFixes) return;
    setIsApplyingFixes(true);
    try {
      await onApplyFixes();
    } finally {
      setIsApplyingFixes(false);
    }
  };

  const allViolations = report.results.flatMap((r) => r.violations);
  const passRate =
    report.errorCount + report.warningCount + report.infoCount > 0
      ? ((report.results.length - report.results.filter((r) => !r.passed).length) /
          report.results.length) *
        100
      : 100;

  return (
    <div className="space-y-6">
      {/* Summary Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-2xl">Enforcement Report</CardTitle>
              <CardDescription>
                {new Date(report.timestamp).toLocaleString()}
              </CardDescription>
            </div>
            {report.passed ? (
              <div className="flex items-center gap-2 text-green-600">
                <CheckCircle2 className="h-8 w-8" />
                <span className="text-lg font-semibold">Passed</span>
              </div>
            ) : (
              <div className="flex items-center gap-2 text-red-600">
                <XCircle className="h-8 w-8" />
                <span className="text-lg font-semibold">Failed</span>
              </div>
            )}
          </div>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* Metrics */}
          <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <XCircle className="h-4 w-4 text-red-500" />
                Errors
              </div>
              <div className="mt-2 text-3xl font-bold text-red-600">
                {report.errorCount}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <AlertTriangle className="h-4 w-4 text-yellow-500" />
                Warnings
              </div>
              <div className="mt-2 text-3xl font-bold text-yellow-600">
                {report.warningCount}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Info className="h-4 w-4 text-blue-500" />
                Info
              </div>
              <div className="mt-2 text-3xl font-bold text-blue-600">
                {report.infoCount}
              </div>
            </div>

            <div className="rounded-lg border p-4">
              <div className="flex items-center gap-2 text-sm text-muted-foreground">
                <Clock className="h-4 w-4" />
                Duration
              </div>
              <div className="mt-2 text-3xl font-bold">
                {report.totalDuration}ms
              </div>
            </div>
          </div>

          {/* Pass Rate */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="font-medium">Pass Rate</span>
              <span className="text-muted-foreground">
                {Math.round(passRate)}%
              </span>
            </div>
            <Progress value={passRate} className="h-2" />
          </div>

          {/* Auto-fix Banner */}
          {report.canAutoFix && onApplyFixes && (
            <Alert className="border-blue-500 bg-blue-50 dark:bg-blue-950">
              <Wrench className="h-4 w-4 text-blue-500" />
              <AlertDescription className="text-blue-700 dark:text-blue-300">
                Some violations can be automatically fixed.
                <Button
                  size="sm"
                  className="ml-4"
                  onClick={handleApplyFixes}
                  disabled={isApplyingFixes}
                >
                  {isApplyingFixes ? 'Applying...' : 'Apply Fixes'}
                </Button>
              </AlertDescription>
            </Alert>
          )}

          {/* Suggestions */}
          {report.suggestions.length > 0 && (
            <div className="space-y-2">
              <h4 className="font-medium">Suggestions:</h4>
              <ul className="list-inside list-disc space-y-1 text-sm text-muted-foreground">
                {report.suggestions.map((suggestion, index) => (
                  <li key={index}>{suggestion}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>

        {onIgnoreAll && !report.passed && (
          <CardFooter>
            <Button variant="outline" onClick={onIgnoreAll} className="w-full">
              Ignore All Violations
            </Button>
          </CardFooter>
        )}
      </Card>

      {/* Violations List */}
      {allViolations.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Violations</CardTitle>
            <CardDescription>
              Review and fix the following violations
            </CardDescription>
          </CardHeader>
          <CardContent>
            <RuleViolationList
              violations={allViolations}
              onAutoFix={
                onApplyFixes
                  ? async () => {
                      await handleApplyFixes();
                    }
                  : undefined
              }
              onIgnore={onIgnoreAll}
            />
          </CardContent>
        </Card>
      )}

      {/* Rule Check Results */}
      <Card>
        <CardHeader>
          <CardTitle>Rule Check Results</CardTitle>
          <CardDescription>
            {report.results.length} rules checked
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {report.results.map((result, index) => (
              <div
                key={index}
                className="flex items-center justify-between rounded-lg border p-3"
              >
                <div className="flex items-center gap-3">
                  {result.passed ? (
                    <CheckCircle2 className="h-5 w-5 text-green-500" />
                  ) : (
                    <XCircle className="h-5 w-5 text-red-500" />
                  )}
                  <div>
                    <code className="text-sm">{result.ruleId}</code>
                    {result.violations.length > 0 && (
                      <span className="ml-2 text-sm text-muted-foreground">
                        ({result.violations.length} violation
                        {result.violations.length !== 1 ? 's' : ''})
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={result.passed ? 'secondary' : 'destructive'}>
                    {result.passed ? 'Passed' : 'Failed'}
                  </Badge>
                  <span className="text-sm text-muted-foreground">
                    {result.duration}ms
                  </span>
                </div>
              </div>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

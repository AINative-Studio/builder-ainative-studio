/**
 * Rule Violation List Component
 * Displays a list of rule violations with actions
 */

'use client';

import React from 'react';
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { AlertCircle, AlertTriangle, Info, Wrench, X } from 'lucide-react';
import type { RuleViolation } from '@/lib/types/enforcement-rules';

interface RuleViolationListProps {
  violations: RuleViolation[];
  onAutoFix?: (violation: RuleViolation) => Promise<void>;
  onIgnore?: (violation: RuleViolation) => void;
}

export function RuleViolationList({
  violations,
  onAutoFix,
  onIgnore,
}: RuleViolationListProps) {
  const getLevelIcon = (level: string) => {
    switch (level) {
      case 'error':
        return <AlertCircle className="h-5 w-5 text-red-500" />;
      case 'warning':
        return <AlertTriangle className="h-5 w-5 text-yellow-500" />;
      case 'info':
        return <Info className="h-5 w-5 text-blue-500" />;
      default:
        return <AlertCircle className="h-5 w-5" />;
    }
  };

  const getLevelColor = (level: string) => {
    switch (level) {
      case 'error':
        return 'destructive';
      case 'warning':
        return 'default';
      case 'info':
        return 'secondary';
      default:
        return 'default';
    }
  };

  if (violations.length === 0) {
    return (
      <Alert className="border-green-500 bg-green-50 dark:bg-green-950">
        <Info className="h-4 w-4 text-green-500" />
        <AlertTitle className="text-green-700 dark:text-green-300">
          All checks passed!
        </AlertTitle>
        <AlertDescription className="text-green-600 dark:text-green-400">
          No violations found. Your code follows all enforcement rules.
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold">
          {violations.length} Violation{violations.length !== 1 ? 's' : ''} Found
        </h3>
        <div className="flex gap-2">
          <Badge variant="destructive">
            {violations.filter((v) => v.level === 'error').length} Errors
          </Badge>
          <Badge variant="default">
            {violations.filter((v) => v.level === 'warning').length} Warnings
          </Badge>
          <Badge variant="secondary">
            {violations.filter((v) => v.level === 'info').length} Info
          </Badge>
        </div>
      </div>

      {violations.map((violation, index) => (
        <Card key={index} className="border-l-4" style={{
          borderLeftColor:
            violation.level === 'error'
              ? 'rgb(239 68 68)'
              : violation.level === 'warning'
              ? 'rgb(234 179 8)'
              : 'rgb(59 130 246)',
        }}>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div className="flex items-start gap-3">
                {getLevelIcon(violation.level)}
                <div>
                  <CardTitle className="text-base">{violation.message}</CardTitle>
                  <CardDescription className="mt-1">
                    Rule: <code className="text-xs">{violation.ruleId}</code>
                  </CardDescription>
                </div>
              </div>
              <Badge variant={getLevelColor(violation.level) as any}>
                {violation.level.toUpperCase()}
              </Badge>
            </div>
          </CardHeader>

          <CardContent className="space-y-4">
            {violation.details && (
              <div className="text-sm text-muted-foreground">
                {violation.details}
              </div>
            )}

            {violation.location && (
              <div className="rounded-md bg-muted p-3 text-sm font-mono">
                {violation.location.file && (
                  <div>
                    <span className="text-muted-foreground">File:</span>{' '}
                    {violation.location.file}
                  </div>
                )}
                {violation.location.line && (
                  <div>
                    <span className="text-muted-foreground">Line:</span>{' '}
                    {violation.location.line}
                  </div>
                )}
                {violation.location.snippet && (
                  <pre className="mt-2 text-xs">{violation.location.snippet}</pre>
                )}
              </div>
            )}

            {violation.suggestion && (
              <div className="rounded-md border border-blue-200 bg-blue-50 p-3 dark:border-blue-800 dark:bg-blue-950">
                <p className="text-sm font-medium text-blue-900 dark:text-blue-100">
                  Suggestion:
                </p>
                <pre className="mt-2 whitespace-pre-wrap text-sm text-blue-800 dark:text-blue-200">
                  {violation.suggestion}
                </pre>
              </div>
            )}

            <div className="flex gap-2">
              {violation.autoFixable && onAutoFix && (
                <Button
                  size="sm"
                  variant="default"
                  onClick={() => onAutoFix(violation)}
                >
                  <Wrench className="mr-2 h-4 w-4" />
                  Auto-fix
                </Button>
              )}
              {onIgnore && (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => onIgnore(violation)}
                >
                  <X className="mr-2 h-4 w-4" />
                  Ignore
                </Button>
              )}
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}

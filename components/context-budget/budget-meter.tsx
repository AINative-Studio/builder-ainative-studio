'use client';

/**
 * Budget Meter Component
 *
 * Displays a visual progress bar showing current token usage against total budget.
 * Includes warning and critical state indicators.
 */

import { useMemo } from 'react';
import { Progress } from '@/components/ui/progress';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { AlertCircle, AlertTriangle, CheckCircle } from 'lucide-react';
import type { ContextBudget } from '@/lib/types/context-budget';

interface BudgetMeterProps {
  budget: ContextBudget;
  className?: string;
  showDetails?: boolean;
}

export function BudgetMeter({ budget, className, showDetails = true }: BudgetMeterProps) {
  const statusConfig = useMemo(() => {
    if (budget.isCritical) {
      return {
        color: 'bg-red-500',
        label: 'Critical',
        icon: AlertCircle,
        variant: 'destructive' as const,
      };
    } else if (budget.isWarning) {
      return {
        color: 'bg-yellow-500',
        label: 'Warning',
        icon: AlertTriangle,
        variant: 'secondary' as const,
      };
    } else {
      return {
        color: 'bg-green-500',
        label: 'Healthy',
        icon: CheckCircle,
        variant: 'default' as const,
      };
    }
  }, [budget.isCritical, budget.isWarning]);

  const StatusIcon = statusConfig.icon;

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  return (
    <Card className={className}>
      <CardContent className="pt-6">
        <div className="space-y-4">
          {/* Header */}
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <h3 className="text-lg font-semibold">Context Budget</h3>
              <Badge variant={statusConfig.variant} className="flex items-center gap-1">
                <StatusIcon className="h-3 w-3" />
                {statusConfig.label}
              </Badge>
            </div>
            <div className="text-right">
              <div className="text-2xl font-bold">{budget.usagePercentage}%</div>
              <div className="text-xs text-muted-foreground">Used</div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="space-y-2">
            <Progress
              value={budget.usagePercentage}
              className="h-3"
              indicatorClassName={statusConfig.color}
            />
            {showDetails && (
              <div className="flex justify-between text-sm text-muted-foreground">
                <span>
                  {formatNumber(budget.used)} / {formatNumber(budget.total)} tokens
                </span>
                <span>{formatNumber(budget.remaining)} remaining</span>
              </div>
            )}
          </div>

          {/* Warning Messages */}
          {budget.isCritical && (
            <div className="rounded-lg bg-red-50 p-3 text-sm text-red-800 dark:bg-red-950 dark:text-red-200">
              <div className="flex items-start gap-2">
                <AlertCircle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Budget Critical</p>
                  <p className="text-xs mt-1">
                    Your context budget is critically low. Consider unloading unused items or
                    optimizing your context.
                  </p>
                </div>
              </div>
            </div>
          )}

          {budget.isWarning && !budget.isCritical && (
            <div className="rounded-lg bg-yellow-50 p-3 text-sm text-yellow-800 dark:bg-yellow-950 dark:text-yellow-200">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="font-medium">Budget Warning</p>
                  <p className="text-xs mt-1">
                    You're approaching your token budget limit. Monitor your context usage.
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

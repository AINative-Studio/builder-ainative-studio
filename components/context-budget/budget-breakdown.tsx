'use client';

/**
 * Budget Breakdown Component
 *
 * Displays a pie chart visualization of token usage by category.
 * Shows allocation percentages and item counts for each category.
 */

import { useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from 'recharts';
import type { ContextBudget, BudgetCategory } from '@/lib/types/context-budget';

interface BudgetBreakdownProps {
  budget: ContextBudget;
  className?: string;
}

// Category colors for the pie chart
const CATEGORY_COLORS: Record<BudgetCategory, string> = {
  baseline: '#3b82f6', // blue
  skills: '#8b5cf6', // purple
  files: '#10b981', // green
  history: '#f59e0b', // amber
  tools: '#ef4444', // red
  other: '#6b7280', // gray
};

const CATEGORY_LABELS: Record<BudgetCategory, string> = {
  baseline: 'Baseline',
  skills: 'Skills',
  files: 'Files',
  history: 'History',
  tools: 'Tools',
  other: 'Other',
};

export function BudgetBreakdown({ budget, className }: BudgetBreakdownProps) {
  const chartData = useMemo(() => {
    return budget.allocations
      .filter((allocation) => allocation.tokens > 0)
      .map((allocation) => ({
        name: CATEGORY_LABELS[allocation.category],
        value: allocation.tokens,
        percentage: allocation.percentage,
        itemCount: allocation.itemCount,
        category: allocation.category,
      }));
  }, [budget.allocations]);

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      return (
        <div className="rounded-lg border bg-background p-3 shadow-lg">
          <p className="font-semibold">{data.name}</p>
          <p className="text-sm text-muted-foreground">
            {formatNumber(data.value)} tokens ({data.percentage}%)
          </p>
          <p className="text-xs text-muted-foreground">{data.itemCount} items</p>
        </div>
      );
    }
    return null;
  };

  const CustomLegend = ({ payload }: any) => {
    return (
      <div className="grid grid-cols-2 gap-2 mt-4">
        {payload.map((entry: any, index: number) => (
          <div key={`legend-${index}`} className="flex items-center gap-2">
            <div
              className="h-3 w-3 rounded-sm"
              style={{ backgroundColor: entry.color }}
            />
            <span className="text-sm text-muted-foreground">
              {entry.value}
              <span className="text-xs ml-1">
                ({entry.payload.percentage}%)
              </span>
            </span>
          </div>
        ))}
      </div>
    );
  };

  if (chartData.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Budget Breakdown</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-64 text-muted-foreground">
            No context items loaded
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>Budget Breakdown</CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-4">
          {/* Pie Chart */}
          <ResponsiveContainer width="100%" height={300}>
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                labelLine={false}
                label={(entry) => `${entry.percentage}%`}
                outerRadius={100}
                fill="#8884d8"
                dataKey="value"
              >
                {chartData.map((entry, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={CATEGORY_COLORS[entry.category]}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
              <Legend content={<CustomLegend />} />
            </PieChart>
          </ResponsiveContainer>

          {/* Detailed Breakdown Table */}
          <div className="border-t pt-4">
            <h4 className="text-sm font-medium mb-3">Detailed Breakdown</h4>
            <div className="space-y-2">
              {budget.allocations
                .filter((allocation) => allocation.tokens > 0)
                .sort((a, b) => b.tokens - a.tokens)
                .map((allocation) => (
                  <div
                    key={allocation.category}
                    className="flex items-center justify-between text-sm"
                  >
                    <div className="flex items-center gap-2">
                      <div
                        className="h-3 w-3 rounded-sm"
                        style={{ backgroundColor: CATEGORY_COLORS[allocation.category] }}
                      />
                      <span>{CATEGORY_LABELS[allocation.category]}</span>
                      <span className="text-muted-foreground">
                        ({allocation.itemCount} items)
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="font-mono">{formatNumber(allocation.tokens)}</span>
                      <span className="text-muted-foreground w-12 text-right">
                        {allocation.percentage}%
                      </span>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

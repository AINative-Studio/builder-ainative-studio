'use client';

/**
 * Optimization Suggestions Component
 *
 * Displays actionable suggestions for reducing token usage.
 * Shows estimated savings and allows applying suggestions.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Lightbulb,
  Trash2,
  FileArchive,
  FileText,
  Layers,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { OptimizationSuggestion } from '@/lib/types/context-budget';

interface OptimizationSuggestionsProps {
  suggestions: OptimizationSuggestion[];
  onApplySuggestion?: (suggestion: OptimizationSuggestion) => Promise<void>;
  className?: string;
}

const SUGGESTION_ICONS = {
  unload: Trash2,
  compress: FileArchive,
  summarize: FileText,
  consolidate: Layers,
};

const PRIORITY_COLORS = {
  high: 'destructive',
  medium: 'secondary',
  low: 'outline',
} as const;

export function OptimizationSuggestions({
  suggestions,
  onApplySuggestion,
  className,
}: OptimizationSuggestionsProps) {
  const [expandedIds, setExpandedIds] = useState<Set<number>>(new Set());
  const [applyingIds, setApplyingIds] = useState<Set<number>>(new Set());

  const toggleExpanded = (index: number) => {
    const newExpanded = new Set(expandedIds);
    if (newExpanded.has(index)) {
      newExpanded.delete(index);
    } else {
      newExpanded.add(index);
    }
    setExpandedIds(newExpanded);
  };

  const handleApply = async (suggestion: OptimizationSuggestion, index: number) => {
    if (!onApplySuggestion) return;

    setApplyingIds(new Set([...applyingIds, index]));
    try {
      await onApplySuggestion(suggestion);
    } finally {
      const newApplying = new Set(applyingIds);
      newApplying.delete(index);
      setApplyingIds(newApplying);
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const totalSavings = suggestions.reduce(
    (sum, suggestion) => sum + suggestion.estimatedSavings,
    0
  );

  if (suggestions.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Optimization Suggestions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-32 text-muted-foreground">
            <Lightbulb className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No optimization suggestions at this time</p>
            <p className="text-xs mt-1">Your context budget is well optimized!</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Lightbulb className="h-5 w-5" />
            Optimization Suggestions
          </CardTitle>
          <div className="text-right">
            <div className="text-sm font-semibold text-green-600 dark:text-green-400">
              Save up to {formatNumber(totalSavings)} tokens
            </div>
            <div className="text-xs text-muted-foreground">
              {suggestions.length} suggestions
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {suggestions.map((suggestion, index) => {
            const Icon = SUGGESTION_ICONS[suggestion.type];
            const isExpanded = expandedIds.has(index);
            const isApplying = applyingIds.has(index);

            return (
              <div
                key={index}
                className="rounded-lg border p-4 space-y-3 hover:bg-accent/50 transition-colors"
              >
                {/* Header */}
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-start gap-3 flex-1">
                    <div className="mt-0.5">
                      <Icon className="h-5 w-5 text-muted-foreground" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <p className="font-medium">{suggestion.description}</p>
                        <Badge variant={PRIORITY_COLORS[suggestion.priority]}>
                          {suggestion.priority}
                        </Badge>
                        {suggestion.autoApplicable && (
                          <Badge variant="outline" className="text-xs">
                            Auto-applicable
                          </Badge>
                        )}
                      </div>
                      <div className="flex items-center gap-4 text-sm text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <span className="font-semibold text-green-600 dark:text-green-400">
                            {formatNumber(suggestion.estimatedSavings)}
                          </span>
                          tokens saved
                        </span>
                        <span>
                          {suggestion.affectedItems.length} items affected
                        </span>
                        <span>
                          {Math.round(suggestion.confidence * 100)}% confidence
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-2">
                    {onApplySuggestion && (
                      <Button
                        size="sm"
                        onClick={() => handleApply(suggestion, index)}
                        disabled={isApplying}
                      >
                        {isApplying ? 'Applying...' : 'Apply'}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      onClick={() => toggleExpanded(index)}
                    >
                      {isExpanded ? (
                        <ChevronUp className="h-4 w-4" />
                      ) : (
                        <ChevronDown className="h-4 w-4" />
                      )}
                    </Button>
                  </div>
                </div>

                {/* Expanded Details */}
                {isExpanded && (
                  <div className="border-t pt-3 space-y-3">
                    {suggestion.reasoning && (
                      <div>
                        <h5 className="text-sm font-medium mb-1">Reasoning</h5>
                        <p className="text-sm text-muted-foreground">
                          {suggestion.reasoning}
                        </p>
                      </div>
                    )}

                    <div>
                      <h5 className="text-sm font-medium mb-2">Affected Items</h5>
                      <div className="space-y-1 max-h-48 overflow-y-auto">
                        {suggestion.affectedItems.map((item) => (
                          <div
                            key={item.id}
                            className="flex items-center justify-between text-xs p-2 rounded bg-muted"
                          >
                            <div className="flex items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {item.type}
                              </Badge>
                              <span className="font-mono">{item.name}</span>
                            </div>
                            <span className="text-muted-foreground">
                              {formatNumber(item.tokenCost)} tokens
                            </span>
                          </div>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

'use client';

/**
 * Budget Dashboard Component
 *
 * Main dashboard that combines all budget visualization components.
 * Provides real-time budget tracking, item management, and optimization suggestions.
 */

import { useEffect, useState, useCallback } from 'react';
import { BudgetMeter } from './budget-meter';
import { BudgetBreakdown } from './budget-breakdown';
import { OptimizationSuggestions } from './optimization-suggestions';
import { ContextItemsList } from './context-items-list';
import { Button } from '@/components/ui/button';
import { RefreshCw, Sparkles } from 'lucide-react';
import { useToast } from '@/components/ui/use-toast';
import type {
  ContextBudget,
  ContextItem,
  OptimizationSuggestion,
  GetBudgetResponse,
  OptimizeResponse,
  UnloadItemsResponse,
} from '@/lib/types/context-budget';

interface BudgetDashboardProps {
  sessionId: string;
  userId: string;
  autoRefresh?: boolean;
  refreshInterval?: number; // milliseconds
  className?: string;
}

export function BudgetDashboard({
  sessionId,
  userId,
  autoRefresh = true,
  refreshInterval = 10000, // 10 seconds
  className,
}: BudgetDashboardProps) {
  const [budget, setBudget] = useState<ContextBudget | null>(null);
  const [items, setItems] = useState<ContextItem[]>([]);
  const [suggestions, setSuggestions] = useState<OptimizationSuggestion[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const { toast } = useToast();

  // Fetch budget data
  const fetchBudget = useCallback(async (showLoading = true) => {
    if (showLoading) setLoading(true);
    else setRefreshing(true);

    try {
      const response = await fetch(
        `/api/context/budget?sessionId=${encodeURIComponent(sessionId)}&userId=${encodeURIComponent(userId)}&includeSuggestions=true`,
        {
          method: 'GET',
          headers: {
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) {
        throw new Error('Failed to fetch budget');
      }

      const data: GetBudgetResponse = await response.json();

      if (data.success) {
        setBudget(data.budget);
        setItems(data.items);
        if (data.suggestions) {
          setSuggestions(data.suggestions);
        }
      } else {
        throw new Error(data.error || 'Unknown error');
      }
    } catch (error) {
      console.error('Failed to fetch budget:', error);
      toast({
        title: 'Error',
        description: 'Failed to load budget data',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [sessionId, userId, toast]);

  // Fetch optimization suggestions
  const fetchSuggestions = useCallback(async () => {
    try {
      const response = await fetch('/api/context/optimize', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          sessionId,
          userId,
          aggressiveness: 'moderate',
        }),
      });

      if (!response.ok) {
        throw new Error('Failed to fetch suggestions');
      }

      const data: OptimizeResponse = await response.json();

      if (data.success) {
        setSuggestions(data.suggestions);
      }
    } catch (error) {
      console.error('Failed to fetch suggestions:', error);
    }
  }, [sessionId, userId]);

  // Unload item
  const handleUnloadItem = useCallback(
    async (itemId: string) => {
      try {
        const response = await fetch('/api/context/unload', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            sessionId,
            userId,
            itemIds: [itemId],
            reason: 'manual_unload',
          }),
        });

        if (!response.ok) {
          throw new Error('Failed to unload item');
        }

        const data: UnloadItemsResponse = await response.json();

        if (data.success) {
          setBudget(data.budget);
          setItems((prev) => prev.filter((item) => item.id !== itemId));

          toast({
            title: 'Item Unloaded',
            description: `Freed ${data.tokensSaved} tokens`,
          });

          // Refresh suggestions
          await fetchSuggestions();
        } else {
          throw new Error('Failed to unload item');
        }
      } catch (error) {
        console.error('Failed to unload item:', error);
        toast({
          title: 'Error',
          description: 'Failed to unload item',
          variant: 'destructive',
        });
      }
    },
    [sessionId, userId, toast, fetchSuggestions]
  );

  // Apply optimization suggestion
  const handleApplySuggestion = useCallback(
    async (suggestion: OptimizationSuggestion) => {
      try {
        if (suggestion.type === 'unload') {
          // Unload affected items
          const itemIds = suggestion.affectedItems.map((item) => item.id);

          const response = await fetch('/api/context/unload', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              sessionId,
              userId,
              itemIds,
              reason: 'optimization',
            }),
          });

          if (!response.ok) {
            throw new Error('Failed to apply suggestion');
          }

          const data: UnloadItemsResponse = await response.json();

          if (data.success) {
            toast({
              title: 'Optimization Applied',
              description: `Freed ${data.tokensSaved} tokens by unloading ${data.unloadedItems.length} items`,
            });

            // Refresh budget
            await fetchBudget(false);
          }
        } else {
          toast({
            title: 'Coming Soon',
            description: `${suggestion.type} optimization is not yet implemented`,
          });
        }
      } catch (error) {
        console.error('Failed to apply suggestion:', error);
        toast({
          title: 'Error',
          description: 'Failed to apply optimization',
          variant: 'destructive',
        });
      }
    },
    [sessionId, userId, toast, fetchBudget]
  );

  // Initial load
  useEffect(() => {
    fetchBudget();
  }, [fetchBudget]);

  // Auto-refresh
  useEffect(() => {
    if (!autoRefresh) return;

    const interval = setInterval(() => {
      fetchBudget(false);
    }, refreshInterval);

    return () => clearInterval(interval);
  }, [autoRefresh, refreshInterval, fetchBudget]);

  if (loading) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-96">
          <div className="text-center space-y-3">
            <RefreshCw className="h-8 w-8 animate-spin text-muted-foreground mx-auto" />
            <p className="text-sm text-muted-foreground">Loading budget data...</p>
          </div>
        </div>
      </div>
    );
  }

  if (!budget) {
    return (
      <div className={className}>
        <div className="flex items-center justify-center h-96">
          <div className="text-center space-y-3">
            <p className="text-muted-foreground">Failed to load budget data</p>
            <Button onClick={() => fetchBudget()}>Retry</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold">Context Budget Manager</h2>
          <p className="text-sm text-muted-foreground mt-1">
            Monitor and optimize your token usage
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={fetchSuggestions}
            disabled={refreshing}
          >
            <Sparkles className="h-4 w-4 mr-2" />
            Refresh Suggestions
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() => fetchBudget(false)}
            disabled={refreshing}
          >
            <RefreshCw className={`h-4 w-4 mr-2 ${refreshing ? 'animate-spin' : ''}`} />
            Refresh
          </Button>
        </div>
      </div>

      {/* Dashboard Grid */}
      <div className="grid gap-6">
        {/* Row 1: Budget Meter */}
        <BudgetMeter budget={budget} />

        {/* Row 2: Breakdown and Suggestions */}
        <div className="grid md:grid-cols-2 gap-6">
          <BudgetBreakdown budget={budget} />
          <OptimizationSuggestions
            suggestions={suggestions}
            onApplySuggestion={handleApplySuggestion}
          />
        </div>

        {/* Row 3: Items List */}
        <ContextItemsList items={items} onUnloadItem={handleUnloadItem} />
      </div>
    </div>
  );
}

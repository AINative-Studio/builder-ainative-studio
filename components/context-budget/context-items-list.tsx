'use client';

/**
 * Context Items List Component
 *
 * Displays a list of all loaded context items with their token costs,
 * priorities, and access counts. Allows unloading items.
 */

import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Trash2, FileCode, Wrench, MessageSquare, Sparkles, Clock } from 'lucide-react';
import type { ContextItem, ContextItemType } from '@/lib/types/context-budget';

interface ContextItemsListProps {
  items: ContextItem[];
  onUnloadItem?: (itemId: string) => Promise<void>;
  className?: string;
}

const ITEM_TYPE_ICONS: Record<ContextItemType, any> = {
  skill: Sparkles,
  file: FileCode,
  message: MessageSquare,
  tool: Wrench,
  baseline: Sparkles,
  history: Clock,
};

const PRIORITY_COLORS = {
  critical: 'destructive',
  high: 'default',
  medium: 'secondary',
  low: 'outline',
} as const;

export function ContextItemsList({
  items,
  onUnloadItem,
  className,
}: ContextItemsListProps) {
  const [sortBy, setSortBy] = useState<'cost' | 'priority' | 'access' | 'name'>('cost');
  const [filterType, setFilterType] = useState<ContextItemType | 'all'>('all');
  const [unloadingIds, setUnloadingIds] = useState<Set<string>>(new Set());

  const handleUnload = async (itemId: string) => {
    if (!onUnloadItem) return;

    setUnloadingIds(new Set([...unloadingIds, itemId]));
    try {
      await onUnloadItem(itemId);
    } finally {
      const newUnloading = new Set(unloadingIds);
      newUnloading.delete(itemId);
      setUnloadingIds(newUnloading);
    }
  };

  const formatNumber = (num: number) => {
    return new Intl.NumberFormat('en-US').format(num);
  };

  const formatDate = (date?: Date) => {
    if (!date) return 'Never';
    return new Intl.DateTimeFormat('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(new Date(date));
  };

  // Filter and sort items
  const filteredItems = items
    .filter((item) => filterType === 'all' || item.type === filterType)
    .sort((a, b) => {
      switch (sortBy) {
        case 'cost':
          return b.tokenCost - a.tokenCost;
        case 'priority':
          const priorityOrder = { critical: 0, high: 1, medium: 2, low: 3 };
          return priorityOrder[a.priority] - priorityOrder[b.priority];
        case 'access':
          return (b.accessCount || 0) - (a.accessCount || 0);
        case 'name':
          return a.name.localeCompare(b.name);
        default:
          return 0;
      }
    });

  const totalCost = items.reduce((sum, item) => sum + item.tokenCost, 0);

  if (items.length === 0) {
    return (
      <Card className={className}>
        <CardHeader>
          <CardTitle>Context Items</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            No context items loaded
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className={className}>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle>
            Context Items
            <span className="ml-2 text-sm font-normal text-muted-foreground">
              ({items.length} items, {formatNumber(totalCost)} tokens)
            </span>
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={filterType} onValueChange={(v) => setFilterType(v as any)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Types</SelectItem>
                <SelectItem value="skill">Skills</SelectItem>
                <SelectItem value="file">Files</SelectItem>
                <SelectItem value="tool">Tools</SelectItem>
                <SelectItem value="message">Messages</SelectItem>
                <SelectItem value="history">History</SelectItem>
                <SelectItem value="baseline">Baseline</SelectItem>
              </SelectContent>
            </Select>
            <Select value={sortBy} onValueChange={(v) => setSortBy(v as any)}>
              <SelectTrigger className="w-32">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="cost">By Cost</SelectItem>
                <SelectItem value="priority">By Priority</SelectItem>
                <SelectItem value="access">By Access</SelectItem>
                <SelectItem value="name">By Name</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="space-y-2 max-h-96 overflow-y-auto">
          {filteredItems.map((item) => {
            const Icon = ITEM_TYPE_ICONS[item.type];
            const isUnloading = unloadingIds.has(item.id);
            const canUnload = item.priority !== 'critical';

            return (
              <div
                key={item.id}
                className="flex items-center justify-between p-3 rounded-lg border hover:bg-accent/50 transition-colors"
              >
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <div className="flex-shrink-0">
                    <Icon className="h-5 w-5 text-muted-foreground" />
                  </div>
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="font-medium truncate max-w-xs">{item.name}</span>
                      <Badge variant="outline" className="text-xs">
                        {item.type}
                      </Badge>
                      <Badge variant={PRIORITY_COLORS[item.priority]} className="text-xs">
                        {item.priority}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-3 text-xs text-muted-foreground">
                      <span className="font-mono">
                        {formatNumber(item.tokenCost)} tokens
                      </span>
                      <span>
                        Accessed {item.accessCount || 0} times
                      </span>
                      <span>
                        Last: {formatDate(item.lastAccessedAt)}
                      </span>
                    </div>
                  </div>
                </div>

                {onUnloadItem && canUnload && (
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => handleUnload(item.id)}
                    disabled={isUnloading}
                  >
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}

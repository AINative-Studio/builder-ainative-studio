/**
 * Context Budget Manager Demo Page
 *
 * Demonstrates all features of the Context Budget Manager system
 */

import { BudgetDashboard } from '@/components/context-budget';

export default function ContextBudgetDemoPage() {
  // In a real application, these would come from the session/auth
  const sessionId = 'demo-session-' + Date.now();
  const userId = 'demo-user';

  return (
    <div className="container mx-auto py-8 px-4">
      <div className="mb-8">
        <h1 className="text-4xl font-bold mb-2">Context Budget Manager</h1>
        <p className="text-lg text-muted-foreground">
          Real-time token usage tracking and optimization for AI conversations
        </p>
      </div>

      {/* Main Dashboard */}
      <BudgetDashboard
        sessionId={sessionId}
        userId={userId}
        autoRefresh={true}
        refreshInterval={10000}
      />

      {/* Feature Overview */}
      <div className="mt-12 grid md:grid-cols-2 lg:grid-cols-3 gap-6">
        <div className="p-6 border rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Real-time Tracking</h3>
          <p className="text-sm text-muted-foreground">
            Monitor token consumption as context items are loaded and unloaded in real-time.
          </p>
        </div>

        <div className="p-6 border rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Smart Loading</h3>
          <p className="text-sm text-muted-foreground">
            Automatically evaluate whether items can be loaded within your budget constraints.
          </p>
        </div>

        <div className="p-6 border rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Visual Breakdown</h3>
          <p className="text-sm text-muted-foreground">
            See exactly how tokens are distributed across different categories with interactive charts.
          </p>
        </div>

        <div className="p-6 border rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Optimization Tips</h3>
          <p className="text-sm text-muted-foreground">
            Get AI-powered suggestions for reducing token usage and extending conversation length.
          </p>
        </div>

        <div className="p-6 border rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Auto-unload</h3>
          <p className="text-sm text-muted-foreground">
            Automatically remove low-priority items when budget reaches critical thresholds.
          </p>
        </div>

        <div className="p-6 border rounded-lg">
          <h3 className="text-lg font-semibold mb-2">Budget Alerts</h3>
          <p className="text-sm text-muted-foreground">
            Receive warnings at 80% and critical alerts at 95% budget usage.
          </p>
        </div>
      </div>

      {/* Usage Stats */}
      <div className="mt-12 p-6 border rounded-lg bg-muted/50">
        <h2 className="text-2xl font-bold mb-4">Expected Benefits</h2>
        <div className="grid md:grid-cols-4 gap-6">
          <div>
            <div className="text-3xl font-bold text-green-600">70%+</div>
            <div className="text-sm text-muted-foreground">Token Usage Reduction</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-blue-600">50ms</div>
            <div className="text-sm text-muted-foreground">Budget Update Time</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-purple-600">200ms</div>
            <div className="text-sm text-muted-foreground">Optimization Analysis</div>
          </div>
          <div>
            <div className="text-3xl font-bold text-orange-600">10ms</div>
            <div className="text-sm text-muted-foreground">Token Calculation</div>
          </div>
        </div>
      </div>

      {/* API Reference */}
      <div className="mt-12">
        <h2 className="text-2xl font-bold mb-4">Available API Endpoints</h2>
        <div className="space-y-3">
          <div className="p-4 border rounded-lg font-mono text-sm">
            <div className="font-bold text-green-600">GET</div>
            <div>/api/context/budget</div>
            <div className="text-muted-foreground text-xs mt-1">
              Get current budget status
            </div>
          </div>

          <div className="p-4 border rounded-lg font-mono text-sm">
            <div className="font-bold text-blue-600">POST</div>
            <div>/api/context/track</div>
            <div className="text-muted-foreground text-xs mt-1">
              Track context item load/unload
            </div>
          </div>

          <div className="p-4 border rounded-lg font-mono text-sm">
            <div className="font-bold text-blue-600">POST</div>
            <div>/api/context/optimize</div>
            <div className="text-muted-foreground text-xs mt-1">
              Get optimization suggestions
            </div>
          </div>

          <div className="p-4 border rounded-lg font-mono text-sm">
            <div className="font-bold text-blue-600">POST</div>
            <div>/api/context/unload</div>
            <div className="text-muted-foreground text-xs mt-1">
              Unload context items
            </div>
          </div>

          <div className="p-4 border rounded-lg font-mono text-sm">
            <div className="font-bold text-blue-600">POST</div>
            <div>/api/context/preload-cost</div>
            <div className="text-muted-foreground text-xs mt-1">
              Calculate pre-load cost
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

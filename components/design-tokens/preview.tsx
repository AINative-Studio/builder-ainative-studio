"use client";

import { DesignTokens } from "@/lib/design-tokens/types";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface DesignTokenPreviewProps {
  tokens: DesignTokens;
}

export function DesignTokenPreview({ tokens }: DesignTokenPreviewProps) {
  // Generate CSS variables from tokens
  const cssVars = {
    '--preview-primary': tokens.colors.primary,
    '--preview-secondary': tokens.colors.secondary,
    '--preview-accent': tokens.colors.accent,
    '--preview-background': tokens.colors.background || '#FFFFFF',
    '--preview-foreground': tokens.colors.foreground || '#0A0A0A',
    '--preview-muted': tokens.colors.muted || '#F4F4F5',
    '--preview-muted-foreground': tokens.colors.mutedForeground || '#71717A',
    '--preview-border': tokens.colors.border || '#E4E4E7',
    '--preview-font-family': tokens.typography.fontFamily,
    '--preview-font-xs': tokens.typography.sizes.xs,
    '--preview-font-sm': tokens.typography.sizes.sm,
    '--preview-font-base': tokens.typography.sizes.base,
    '--preview-font-lg': tokens.typography.sizes.lg,
    '--preview-font-xl': tokens.typography.sizes.xl,
  } as React.CSSProperties;

  return (
    <Tabs defaultValue="light" className="w-full">
      <TabsList className="grid w-full grid-cols-2">
        <TabsTrigger value="light">Light Mode</TabsTrigger>
        <TabsTrigger value="dark">Dark Mode</TabsTrigger>
      </TabsList>

      <TabsContent value="light" className="space-y-4">
        <div style={cssVars} className="rounded-lg border p-6 space-y-6">
          {/* Typography Preview */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Typography
            </h3>
            <div className="space-y-2">
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-xl)' }}>
                Extra Large Text ({tokens.typography.sizes.xl})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-lg)' }}>
                Large Text ({tokens.typography.sizes.lg})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-base)' }}>
                Base Text ({tokens.typography.sizes.base})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-sm)' }}>
                Small Text ({tokens.typography.sizes.sm})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-xs)' }}>
                Extra Small Text ({tokens.typography.sizes.xs})
              </p>
            </div>
          </div>

          {/* Colors Preview */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Colors
            </h3>
            <div className="flex flex-wrap gap-2">
              <div className="text-center space-y-2">
                <div
                  className="w-20 h-20 rounded-lg shadow-sm"
                  style={{ backgroundColor: 'var(--preview-primary)' }}
                />
                <p className="text-xs text-muted-foreground">Primary</p>
              </div>
              <div className="text-center space-y-2">
                <div
                  className="w-20 h-20 rounded-lg shadow-sm"
                  style={{ backgroundColor: 'var(--preview-secondary)' }}
                />
                <p className="text-xs text-muted-foreground">Secondary</p>
              </div>
              <div className="text-center space-y-2">
                <div
                  className="w-20 h-20 rounded-lg shadow-sm"
                  style={{ backgroundColor: 'var(--preview-accent)' }}
                />
                <p className="text-xs text-muted-foreground">Accent</p>
              </div>
            </div>
          </div>

          {/* Button Samples */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Buttons
            </h3>
            <div className="flex flex-wrap gap-3">
              <button
                style={{
                  backgroundColor: 'var(--preview-primary)',
                  color: 'white',
                  fontFamily: 'var(--preview-font-family)',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
              >
                Primary Button
              </button>
              <button
                style={{
                  backgroundColor: 'var(--preview-secondary)',
                  color: 'white',
                  fontFamily: 'var(--preview-font-family)',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
              >
                Secondary Button
              </button>
              <button
                style={{
                  backgroundColor: 'var(--preview-accent)',
                  color: 'white',
                  fontFamily: 'var(--preview-font-family)',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
              >
                Accent Button
              </button>
            </div>
          </div>

          {/* Card Sample */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Card Component
            </h3>
            <div
              style={{
                backgroundColor: 'var(--preview-background)',
                borderColor: 'var(--preview-border)',
                fontFamily: 'var(--preview-font-family)',
              }}
              className="border rounded-lg p-4 space-y-2"
            >
              <h4
                style={{
                  color: 'var(--preview-foreground)',
                  fontSize: 'var(--preview-font-lg)',
                }}
                className="font-semibold"
              >
                Card Title
              </h4>
              <p
                style={{
                  color: 'var(--preview-muted-foreground)',
                  fontSize: 'var(--preview-font-sm)',
                }}
              >
                This is a sample card with your design tokens applied. The spacing, colors, and typography all reflect your design system.
              </p>
              <button
                style={{
                  backgroundColor: 'var(--preview-primary)',
                  color: 'white',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity"
              >
                Card Action
              </button>
            </div>
          </div>

          {/* Spacing Preview */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-muted-foreground uppercase tracking-wide">
              Spacing Scale (Base: {tokens.spacing.baseUnit})
            </h3>
            <div className="space-y-2">
              {tokens.spacing.scale.slice(0, 8).map((value, index) => {
                const baseValue = parseFloat(tokens.spacing.baseUnit);
                const unit = tokens.spacing.baseUnit.replace(/[\d.]/g, '');
                const computedSpacing = `${baseValue * value}${unit}`;

                return (
                  <div key={index} className="flex items-center gap-3">
                    <span className="text-xs text-muted-foreground w-8">{value}x:</span>
                    <div
                      style={{
                        width: computedSpacing,
                        backgroundColor: 'var(--preview-primary)',
                      }}
                      className="h-4 rounded"
                    />
                    <span className="text-xs text-muted-foreground">{computedSpacing}</span>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </TabsContent>

      <TabsContent value="dark" className="space-y-4">
        <div
          style={{
            ...cssVars,
            '--preview-background': tokens.colors.foreground || '#0A0A0A',
            '--preview-foreground': tokens.colors.background || '#FFFFFF',
          }}
          className="rounded-lg border border-zinc-800 bg-zinc-950 p-6 space-y-6"
        >
          {/* Typography Preview - Dark */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-zinc-400 uppercase tracking-wide">
              Typography
            </h3>
            <div className="space-y-2">
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-xl)', color: 'var(--preview-foreground)' }}>
                Extra Large Text ({tokens.typography.sizes.xl})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-lg)', color: 'var(--preview-foreground)' }}>
                Large Text ({tokens.typography.sizes.lg})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-base)', color: 'var(--preview-foreground)' }}>
                Base Text ({tokens.typography.sizes.base})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-sm)', color: 'var(--preview-foreground)' }}>
                Small Text ({tokens.typography.sizes.sm})
              </p>
              <p style={{ fontFamily: 'var(--preview-font-family)', fontSize: 'var(--preview-font-xs)', color: 'var(--preview-foreground)' }}>
                Extra Small Text ({tokens.typography.sizes.xs})
              </p>
            </div>
          </div>

          {/* Colors Preview - Dark */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-zinc-400 uppercase tracking-wide">
              Colors
            </h3>
            <div className="flex flex-wrap gap-2">
              <div className="text-center space-y-2">
                <div
                  className="w-20 h-20 rounded-lg shadow-sm"
                  style={{ backgroundColor: 'var(--preview-primary)' }}
                />
                <p className="text-xs text-zinc-400">Primary</p>
              </div>
              <div className="text-center space-y-2">
                <div
                  className="w-20 h-20 rounded-lg shadow-sm"
                  style={{ backgroundColor: 'var(--preview-secondary)' }}
                />
                <p className="text-xs text-zinc-400">Secondary</p>
              </div>
              <div className="text-center space-y-2">
                <div
                  className="w-20 h-20 rounded-lg shadow-sm"
                  style={{ backgroundColor: 'var(--preview-accent)' }}
                />
                <p className="text-xs text-zinc-400">Accent</p>
              </div>
            </div>
          </div>

          {/* Button Samples - Dark */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-zinc-400 uppercase tracking-wide">
              Buttons
            </h3>
            <div className="flex flex-wrap gap-3">
              <button
                style={{
                  backgroundColor: 'var(--preview-primary)',
                  color: 'white',
                  fontFamily: 'var(--preview-font-family)',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
              >
                Primary Button
              </button>
              <button
                style={{
                  backgroundColor: 'var(--preview-secondary)',
                  color: 'white',
                  fontFamily: 'var(--preview-font-family)',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
              >
                Secondary Button
              </button>
              <button
                style={{
                  backgroundColor: 'var(--preview-accent)',
                  color: 'white',
                  fontFamily: 'var(--preview-font-family)',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-4 py-2 rounded-md hover:opacity-90 transition-opacity"
              >
                Accent Button
              </button>
            </div>
          </div>

          {/* Card Sample - Dark */}
          <div className="space-y-3">
            <h3 className="font-semibold text-sm text-zinc-400 uppercase tracking-wide">
              Card Component
            </h3>
            <div
              style={{
                backgroundColor: 'var(--preview-background)',
                borderColor: '#3F3F46',
                fontFamily: 'var(--preview-font-family)',
              }}
              className="border rounded-lg p-4 space-y-2"
            >
              <h4
                style={{
                  color: 'var(--preview-foreground)',
                  fontSize: 'var(--preview-font-lg)',
                }}
                className="font-semibold"
              >
                Card Title
              </h4>
              <p
                style={{
                  color: '#A1A1AA',
                  fontSize: 'var(--preview-font-sm)',
                }}
              >
                This is a sample card with your design tokens applied. The spacing, colors, and typography all reflect your design system.
              </p>
              <button
                style={{
                  backgroundColor: 'var(--preview-primary)',
                  color: 'white',
                  fontSize: 'var(--preview-font-sm)',
                }}
                className="px-3 py-1.5 rounded-md hover:opacity-90 transition-opacity"
              >
                Card Action
              </button>
            </div>
          </div>
        </div>
      </TabsContent>
    </Tabs>
  );
}

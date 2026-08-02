'use client'

/**
 * Evidence Page
 *
 * Central place to browse collected proof (test runs, builds, coverage,
 * deployments) via a gallery or chronological timeline. Backs issue #19's
 * "visual gallery" acceptance criterion.
 */

import { useState } from 'react'
import { AppHeader } from '@/components/shared/app-header'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { EvidenceGallery } from '@/components/evidence/evidence-gallery'
import { EvidenceTimeline } from '@/components/evidence/evidence-timeline'
import type { Evidence } from '@/lib/types/evidence'
import { LayoutGrid, ListOrdered, ShieldCheck } from 'lucide-react'

export default function EvidencePage() {
  const [, setSelected] = useState<Evidence | null>(null)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-6 w-6 text-primary" />
            <h1 className="text-3xl font-bold">Evidence</h1>
          </div>
          <p className="mt-1 text-muted-foreground">
            Automated proof for every claim — test runs, builds, coverage and
            deployments. Verify before you trust.
          </p>
        </div>

        <Tabs defaultValue="gallery" className="w-full">
          <TabsList>
            <TabsTrigger value="gallery" className="flex items-center gap-2">
              <LayoutGrid className="h-4 w-4" />
              Gallery
            </TabsTrigger>
            <TabsTrigger value="timeline" className="flex items-center gap-2">
              <ListOrdered className="h-4 w-4" />
              Timeline
            </TabsTrigger>
          </TabsList>

          <TabsContent value="gallery" className="mt-4">
            <div className="rounded-lg border bg-background">
              <EvidenceGallery onEvidenceSelect={setSelected} />
            </div>
          </TabsContent>

          <TabsContent value="timeline" className="mt-4">
            <div className="rounded-lg border bg-background p-2">
              <EvidenceTimeline />
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  )
}

'use client'

/**
 * Agent Skills settings page (#1213) — the real UI consumer for
 * components/skills/skill-browser.tsx (built, fully-functional, zero
 * mounters anywhere) and, through it, the previously orphaned
 * GET /api/skills/search and POST /api/skills/recommend.
 *
 * "Agent skills" here are this app's own analog to .claude/skills — small,
 * reusable instruction bundles an agent loads on demand (agent-skill.
 * service.ts cites the same progressive-disclosure design). This page lets
 * a signed-in user browse/search them and see context-based
 * recommendations; selecting one shows its full content inline.
 */

import { useState } from 'react'
import { useSession } from 'next-auth/react'
import { AppHeader } from '@/components/shared/app-header'
import { SkillBrowser } from '@/components/skills/skill-browser'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'

// GET /api/skills/[skillId] actually returns the raw `skills` table row
// (flat: name/description/content), not the nested AgentSkill.metadata
// shape the SkillBrowserProps type declares — a pre-existing mismatch in
// this codebase (skill-browser.tsx itself accesses the flat shape, e.g.
// `skill.tags` on what the type calls SkillMetadata). Typed loosely here
// to match the real runtime payload rather than the aspirational type.
type SelectedSkill = { id: string; name: string; description: string; content: string }

export default function SkillsSettingsPage() {
  const { data: session } = useSession()
  const [selected, setSelected] = useState<SelectedSkill | null>(null)

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-black">
      <AppHeader />
      <div className="container mx-auto max-w-6xl px-4 py-8">
        <div className="mb-6">
          <h1 className="mb-2 text-3xl font-bold text-gray-900 dark:text-white">
            Agent Skills
          </h1>
          <p className="text-gray-600 dark:text-gray-400">
            Browse and search the skill library agents can load on demand.
          </p>
        </div>

        {selected ? (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle>{selected.name}</CardTitle>
              <Button variant="outline" size="sm" onClick={() => setSelected(null)} data-testid="skill-detail-back">
                ‹ Back to browser
              </Button>
            </CardHeader>
            <CardContent>
              <p className="mb-4 text-sm text-muted-foreground">{selected.description}</p>
              <pre className="max-h-[60vh] overflow-auto rounded-md bg-muted p-4 text-xs">
                {selected.content}
              </pre>
            </CardContent>
          </Card>
        ) : (
          <div className="h-[75vh] rounded-lg border bg-white dark:bg-gray-950">
            <SkillBrowser
              onSkillSelect={(skill) => setSelected(skill as unknown as SelectedSkill)}
              currentContext={
                session?.user
                  ? {
                      sessionId: (session as any).user?.id || 'session',
                      userId: (session as any).user?.id || '',
                    }
                  : undefined
              }
            />
          </div>
        )}
      </div>
    </div>
  )
}

# Git Integration for AINative Builder

AINative Builder provides automatic git repository management for every company built on the platform. This document covers how to use the git integration features.

## Overview

When you create a company with AINative Builder, you automatically get:

- **Private git repository** — your source code in a real git repo
- **Version history** — every regeneration creates a new commit
- **Task tracking** — each task becomes a branch with its own commits
- **Code ownership** — fork or export your code at any time

## How It Works

### 1. Company Creation

When a company is provisioned:

```
Company created → Git repo created → Initial commit pushed
```

The initial commit contains your generated app's source code.

### 2. Regenerations

Every time Cody regenerates your app:

```
Regeneration → New commit on main → Full history preserved
```

Your git history shows the evolution of your app.

### 3. Task-Based Development

When Cody works on a specific task:

```
Task started → Branch created (task/{taskId})
Task completed → Files committed to branch
PR created → Review before merge to main
```

This gives you:
- **Isolated changes** — each task is a separate branch
- **Reviewable diffs** — see exactly what changed
- **Revertable history** — roll back individual tasks

## Accessing Your Repository

### Via AINative Dashboard

1. Go to your company dashboard
2. Click **Settings → Git Repository**
3. View your repo URL and access options

### Collaborator Access

To grant a human collaborator write access:

1. Go to **Settings → Collaborators**
2. Enter their Gitea username
3. Select permission level (read/write)
4. Click **Invite**

## API Reference

### Provision Company Repo

```typescript
import { provisionCompanyRepo } from '@/lib/git/company-repo'

const result = await provisionCompanyRepo({
  workspaceId: 'ws-123',
  slug: 'my-company',
  files: {
    'App.tsx': '...',
    'styles.css': '...',
  },
})

// result: { ok: true, gitRepoUrl: '...', gitRepoId: '...', gitOrg: '...' }
```

### Commit Task Changes

```typescript
import { commitTaskChanges } from '@/lib/git/task-git-sync'

const result = await commitTaskChanges({
  taskId: 't_abc123',
  slug: 'my-company',
  files: { 'App.tsx': '...' },
  title: 'Add login button',
  createPR: true,
})

// result: { ok: true, branchName: 'task/t_abc123', prNumber: 42, prUrl: '...' }
```

### Grant Collaborator Access

```typescript
import { grantHumanWrite } from '@/lib/git/company-repo'

const success = await grantHumanWrite('my-company', 'username', 'write')
```

## Coding Standards

All code committed through the builder follows AINative coding standards:

| Standard | Enforcement |
|----------|-------------|
| No AI attribution | Automated check on commits |
| TDD compliance | Changed files must have tests |
| 80% coverage | Minimum test coverage required |
| TypeScript strict | Type errors block commits |

See [Coding Standards](/docs/coding-standards) for details.

## Committee Review

PRs from task branches go through multi-model committee review:

1. **Standards Gate** — automated coding standards check
2. **Committee Review** — 3 AI models review the diff
3. **Weighted Verdict** — chair model breaks ties
4. **Merge Gate** — only approved PRs can merge

This ensures high-quality code across all regenerations.

## Exporting Your Code

You own your code. To export:

### Clone via Git

```bash
git clone https://git.ainative.studio/ws-{workspace}/{company}.git
```

### Download ZIP

1. Go to your repo on git.ainative.studio
2. Click **Code → Download ZIP**

### Fork to GitHub

1. Click **Fork** on your Gitea repo page
2. Select GitHub as destination
3. Your full history is preserved

## FAQ

### Is my code private?

Yes. All repos are private by default, accessible only to:
- Your AINative account (read access)
- Collaborators you explicitly invite
- The Cody AI agent (for regenerations)

### Can I edit code directly?

By default, you have read-only access. To enable direct editing:
1. Request collaborator write access
2. Or use Cody to make changes (recommended)

### What happens if I delete my company?

Your git repository is archived (not deleted). Contact support to:
- Restore the company
- Export the repository
- Permanently delete

### Can I use my own GitHub repo?

Coming soon. We're working on GitHub/GitLab sync for companies that want to use their existing repos.

## Support

- **Docs**: docs.ainative.studio
- **Email**: support@ainative.studio
- **Discord**: discord.gg/ainative

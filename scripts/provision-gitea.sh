#!/bin/bash
# Provision Gitea on Railway
#
# Prerequisites:
#   1. Railway CLI installed and authenticated
#   2. Existing Railway project for AINative Builder
#
# Usage:
#   ./scripts/provision-gitea.sh

set -e

echo "🔧 Provisioning Gitea on Railway..."

# Check Railway CLI
if ! command -v railway &> /dev/null; then
    echo "❌ Railway CLI not found. Install with: npm i -g @railway/cli"
    exit 1
fi

# Check if logged in
if ! railway whoami &> /dev/null; then
    echo "❌ Not logged into Railway. Run: railway login"
    exit 1
fi

echo ""
echo "📦 Step 1: Create PostgreSQL service for Gitea"
echo "   Run in Railway dashboard or CLI:"
echo "   railway add postgres --name gitea-db"
echo ""

echo "📦 Step 2: Deploy Gitea service"
echo "   cd deployment/gitea && railway up --service gitea"
echo ""

echo "🔑 Step 3: Set environment variables in Railway"
echo "   GITEA_DATABASE_URL  = (from gitea-db service)"
echo "   GITEA__server__ROOT_URL = https://git.ainative.studio"
echo ""

echo "🔑 Step 4: Create Gitea admin account"
echo "   1. Access Gitea at the deployed URL"
echo "   2. Complete initial setup"
echo "   3. Create admin account"
echo ""

echo "🔑 Step 5: Generate admin API token"
echo "   1. Log into Gitea as admin"
echo "   2. Settings → Applications → Generate New Token"
echo "   3. Name: builder-admin"
echo "   4. Scopes: write:organization, write:repository, write:user"
echo ""

echo "🔑 Step 6: Set builder environment variables"
echo "   In the main builder service on Railway:"
echo "   GITEA_BASE_URL = https://git.ainative.studio"
echo "   GITEA_ADMIN_TOKEN = (token from step 5)"
echo "   GITEA_WEBHOOK_SECRET = (generate with: openssl rand -hex 32)"
echo ""

echo "🔗 Step 7: Configure Gitea webhook"
echo "   1. Gitea → Admin → System → Webhooks → Add"
echo "   2. URL: https://builder.ainative.studio/api/webhooks/gitea"
echo "   3. Secret: (same as GITEA_WEBHOOK_SECRET)"
echo "   4. Events: Pull Request"
echo ""

echo "✅ After completing all steps, verify with:"
echo "   curl https://builder.ainative.studio/api/webhooks/gitea"
echo "   Expected: { \"service\": \"gitea-webhook\", \"status\": \"ready\" }"
echo ""
echo "📚 Full documentation: docs/GITEA_PROVISIONING.md"

#!/bin/bash

# Production Deployment Script for builder.ainative.studio
# This script automates the deployment process with safety checks

set -e  # Exit on error

echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
echo "🚀 Production Deployment Script for builder.ainative.studio"
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Check if Vercel CLI is installed
if ! command -v vercel &> /dev/null; then
    echo -e "${RED}❌ Vercel CLI is not installed${NC}"
    echo "Install it with: npm i -g vercel"
    exit 1
fi

# Step 1: Validate environment variables
echo -e "\n${BLUE}📋 Step 1: Validating environment variables...${NC}"
if ! npx tsx scripts/validate-env.ts; then
    echo -e "${RED}❌ Environment validation failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Environment variables validated${NC}"

# Step 2: Run tests
echo -e "\n${BLUE}🧪 Step 2: Running tests...${NC}"
if ! pnpm run test; then
    echo -e "${RED}❌ Tests failed${NC}"
    read -p "Do you want to continue anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
else
    echo -e "${GREEN}✅ Tests passed${NC}"
fi

# Step 3: Check git status
echo -e "\n${BLUE}📦 Step 3: Checking git status...${NC}"
if [[ -n $(git status -s) ]]; then
    echo -e "${YELLOW}⚠️  You have uncommitted changes${NC}"
    git status -s
    read -p "Do you want to continue? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Get current branch
BRANCH=$(git rev-parse --abbrev-ref HEAD)
echo -e "Current branch: ${GREEN}$BRANCH${NC}"

if [[ "$BRANCH" != "main" ]]; then
    echo -e "${YELLOW}⚠️  You are not on the main branch${NC}"
    read -p "Do you want to continue deploying from $BRANCH? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Step 4: Build the application
echo -e "\n${BLUE}🔨 Step 4: Building application...${NC}"
if ! pnpm run build; then
    echo -e "${RED}❌ Build failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Build successful${NC}"

# Step 5: Deploy to preview first
echo -e "\n${BLUE}🚢 Step 5: Deploying to preview environment...${NC}"
PREVIEW_URL=$(vercel --yes 2>&1 | grep -o 'https://[^ ]*')
echo -e "${GREEN}✅ Preview deployed to: $PREVIEW_URL${NC}"

# Step 6: Test preview deployment
echo -e "\n${BLUE}🔍 Step 6: Testing preview deployment...${NC}"
sleep 5  # Wait for deployment to be ready

if curl -f -s "$PREVIEW_URL/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Health check passed on preview${NC}"
else
    echo -e "${RED}❌ Health check failed on preview${NC}"
    read -p "Do you want to continue to production anyway? (y/N) " -n 1 -r
    echo
    if [[ ! $REPLY =~ ^[Yy]$ ]]; then
        exit 1
    fi
fi

# Step 7: Confirm production deployment
echo -e "\n${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${YELLOW}⚠️  PRODUCTION DEPLOYMENT CONFIRMATION${NC}"
echo -e "${YELLOW}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "\nYou are about to deploy to production:"
echo -e "  Domain: ${GREEN}builder.ainative.studio${NC}"
echo -e "  Branch: ${GREEN}$BRANCH${NC}"
echo -e "  Preview: ${BLUE}$PREVIEW_URL${NC}"
echo ""
read -p "Are you sure you want to deploy to PRODUCTION? (yes/no) " -r
echo

if [[ ! $REPLY == "yes" ]]; then
    echo -e "${YELLOW}⚠️  Production deployment cancelled${NC}"
    exit 0
fi

# Step 8: Deploy to production
echo -e "\n${BLUE}🚀 Step 8: Deploying to production...${NC}"
if ! vercel --prod --yes; then
    echo -e "${RED}❌ Production deployment failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Production deployment successful${NC}"

# Step 9: Verify production deployment
echo -e "\n${BLUE}🔍 Step 9: Verifying production deployment...${NC}"
sleep 10  # Wait for deployment to propagate

if curl -f -s "https://builder.ainative.studio/api/health" > /dev/null; then
    echo -e "${GREEN}✅ Production health check passed${NC}"
else
    echo -e "${RED}❌ Production health check failed${NC}"
    echo -e "${YELLOW}⚠️  You may need to check the deployment manually${NC}"
fi

# Step 10: Post-deployment tasks
echo -e "\n${BLUE}📊 Step 10: Post-deployment tasks...${NC}"
echo -e "${GREEN}✅ Deployment complete!${NC}"
echo -e "\n${BLUE}📝 Post-deployment checklist:${NC}"
echo "  [ ] Verify https://builder.ainative.studio is accessible"
echo "  [ ] Check https://builder.ainative.studio/api/health"
echo "  [ ] Monitor error logs in Vercel dashboard"
echo "  [ ] Check database migrations ran successfully"
echo "  [ ] Test key user flows"
echo "  [ ] Monitor performance metrics"
echo ""
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}✨ Deployment completed successfully!${NC}"
echo -e "${GREEN}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""

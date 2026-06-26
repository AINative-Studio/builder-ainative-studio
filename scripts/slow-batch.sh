#!/bin/bash
# Slow-drip batch generation — 1 app every 45 seconds
# Populates showcase with working examples without triggering rate limits

BASE_URL="${PLAYWRIGHT_BASE_URL:-http://localhost:3002}"
DELAY=45  # seconds between generations
SUCCESS=0
FAIL=0
EMPTY=0

PROMPTS=(
  "Build a fitness tracking SaaS landing page with hero, 4 feature cards with Lucide icons, AIKitPriceCard pricing tiers, and testimonials"
  "Build a crypto exchange landing page with live price ticker cards for BTC ETH SOL, feature comparison table, security SafetyBadge"
  "Build an online learning platform landing page with course cards, instructor AIKitAvatar profiles, AIKitPriceCard pricing"
  "Build a real estate landing page with property search bar, 6 property cards with price and features, agent contact form"
  "Build a developer tools landing page for CodeShip with terminal-style hero, CodeDisplay code snippets, MetricCards for usage"
  "Build a food delivery app landing page with restaurant categories, popular dishes grid, AIKitStepper for how-it-works"
  "Build an e-commerce analytics dashboard with AIKitSidebar, 4 MetricCards with sparklineData, Recharts AreaChart, AIKitTable"
  "Build a DevOps monitoring dashboard with sidebar, MetricCards for CPU Memory Requests Errors, Recharts LineChart for latency"
  "Build an HR people dashboard with AIKitSidebar, MetricCards for employees and satisfaction, AIKitTable of recent hires"
  "Build a social media analytics dashboard with MetricCards for followers engagement impressions, Recharts BarChart"
  "Build a finance portfolio dashboard with asset allocation PieChart, performance LineChart, holdings AIKitTable"
  "Build a marketing campaign dashboard with MetricCards for spend leads CPA ROI, funnel BarChart, campaign AIKitTable"
  "Build an IoT sensor monitoring dashboard with MetricCards for temperature humidity air quality, Recharts LineChart"
  "Build a customer support dashboard with MetricCards for tickets response time CSAT, ticket queue AIKitTable"
  "Build a sales pipeline dashboard with MetricCards for pipeline value win rate, deals BarChart, top deals AIKitTable"
  "Build a CMS dashboard with AIKitSidebar, content stats MetricCards, recent articles AIKitTable, author timeline"
  "Build a Kanban board TaskFlow with 3 columns To Do In Progress Done, task cards with AIKitAvatar assignee and priority Badge"
  "Build an AI chat app with conversation sidebar, ChatBubble messages alternating user assistant, StreamingIndicator"
  "Build a restaurant menu Sakura Kitchen with category tabs, menu cards with name description price AIKitRating"
  "Build a weather dashboard with city search, current conditions card, 7-day forecast, Recharts temperature chart"
  "Build an expense tracker with category dropdown, amount input, Recharts BarChart by category, transaction AIKitTable"
  "Build a recipe book app with search bar, category tabs, recipe cards with time difficulty Badge"
  "Build a music player with album art, song title artist, playback controls, progress bar, playlist queue"
  "Build a note-taking app with sidebar folders, note list, editor area, tag badges, search"
  "Build a fitness tracker with daily stats MetricCards steps calories distance, Recharts weekly activity chart"
  "Build an invoice generator with company info, line items table, subtotal tax total, client details"
  "Build a calendar scheduler with month view grid, color-coded event cards, upcoming events sidebar"
  "Build a file manager with breadcrumb nav, grid list toggle, file cards with icon name size date"
  "Build a settings page with sidebar sections Profile Security Notifications, profile form, notification toggles"
  "Build a booking system with service cards, date picker, time slots, booking summary, AIKitStepper progress"
  "Build a survey builder with question type selector, question list, preview panel, response counter MetricCard"
  "Build an agent operations center with SwarmView 6 agents, MetricCards, TokenUsageBar, AgentTimeline, GuardrailPanel"
  "Build an e-commerce product listing with AIKitHeader, search filters, 6 AIKitProductCard, AIKitPagination"
  "Build a tech blog DevPulse with featured article hero, 6 article cards with category Badges, newsletter signup"
  "Build a video gallery with VideoPlayer hero, thumbnail grid, category tabs, view count badges"
  "Build an inventory management system with AIKitSidebar, MetricCards for stock levels, AIKitTable, AIKitBanner alerts"
  "Build an event management platform with event cards, calendar view, attendee AIKitAvatar list, AIKitPriceCard tickets"
  "Build a code review interface with file tree sidebar, diff viewer CodeDisplay, comment threads, approval badges"
  "Build a reports dashboard with date range picker, Recharts multi-line chart, data cards, AIKitTable"
  "Build a team directory with search bar, department tabs, member cards with AIKitAvatar name role status Badge"
  "Build a subscription management page with current plan card, usage MetricCards, AIKitPriceCard comparison, billing AIKitTable"
  "Build a feedback dashboard with overall score MetricCard, AIKitRating distribution BarChart, feedback AIKitTable"
  "Build an API docs page with sidebar endpoint nav, method Badge, CodeDisplay request response, parameter table"
  "Build a user onboarding wizard with AIKitStepper 4 steps, form fields per step, progress indicator"
  "Build a notification center with tabs All Unread Mentions, notification items with icon title time, preferences"
  "Build a competitive leaderboard with top 3 podium, ranked AIKitTable with avatar score streak, time period tabs"
  "Build a project timeline with Gantt-style bars, milestone markers, team member assignments, progress percentages"
  "Build a podcast player app with episode list, player controls, show notes, subscribe button, episode search"
  "Build a habit tracker with daily check grid, streak counter MetricCards, weekly completion Recharts chart"
  "Build a job board with search filters, job cards with company logo title salary location badges, apply button"
)

echo "🚀 Starting slow-drip batch: ${#PROMPTS[@]} prompts, ${DELAY}s delay"
echo ""

for i in "${!PROMPTS[@]}"; do
  PROMPT="${PROMPTS[$i]}"
  NUM=$((i + 1))

  echo "[$NUM/${#PROMPTS[@]}] Generating..."

  # Generate via API
  RESULT=$(curl -s -X POST "$BASE_URL/api/chat-ws" \
    -H 'Content-Type: application/json' \
    -d "{\"message\":\"$PROMPT\"}" \
    --max-time 120 2>&1)

  # Check if we got a complete event with files
  HAS_FILES=$(echo "$RESULT" | grep -c '"type":"files"')
  HAS_COMPLETE=$(echo "$RESULT" | grep -c '"type":"complete"')
  HAS_CHUNK=$(echo "$RESULT" | grep -c '"type":"chunk"')

  if [ "$HAS_FILES" -gt 0 ] && [ "$HAS_COMPLETE" -gt 0 ]; then
    SUCCESS=$((SUCCESS + 1))
    echo "  ✅ Success (files+complete) — total: $SUCCESS"
  elif [ "$HAS_CHUNK" -gt 0 ]; then
    SUCCESS=$((SUCCESS + 1))
    echo "  ✅ Success (chunk) — total: $SUCCESS"
  elif [ "$HAS_COMPLETE" -gt 0 ]; then
    EMPTY=$((EMPTY + 1))
    echo "  ⚠️  Complete but no files (empty response) — empty: $EMPTY"
  else
    FAIL=$((FAIL + 1))
    echo "  ❌ Failed (timeout/error) — fails: $FAIL"
  fi

  # Wait between generations
  if [ $NUM -lt ${#PROMPTS[@]} ]; then
    echo "  ⏳ Waiting ${DELAY}s..."
    sleep $DELAY
  fi
done

echo ""
echo "=== BATCH COMPLETE ==="
echo "Success: $SUCCESS"
echo "Empty:   $EMPTY"
echo "Failed:  $FAIL"
echo "Total:   ${#PROMPTS[@]}"

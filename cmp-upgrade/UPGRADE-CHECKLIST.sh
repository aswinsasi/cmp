#!/bin/bash
# ══════════════════════════════════════════════════════════════
# CMP — Publish Checklist & Upgrade Script
# Run each step manually. This is a checklist, not fully automated.
# ══════════════════════════════════════════════════════════════

echo "═══════════════════════════════════════════════"
echo "  CMP 6.5 → 8+ Upgrade Checklist"
echo "═══════════════════════════════════════════════"

# ──────────────────────────────────────────────
# STEP 1: Clean API surface (+0.3)
# ──────────────────────────────────────────────
echo ""
echo "Step 1: Replace v4-public-api.ts with v5-public-api.ts"
echo "  - Copy: packages/core/src/v5-public-api.ts"
echo "  - Update package.npm.json → use package.v5.json"
echo "  - Bio metaphors are still in /src but NOT exported"
echo "  - Run: npm run test (all 320+ should pass)"

# ──────────────────────────────────────────────
# STEP 2: Run benchmarks (+0.5)
# ──────────────────────────────────────────────
echo ""
echo "Step 2: Run scaling benchmark"
echo "  cd packages/core"
echo "  npx tsx benchmarks/scaling-benchmark.ts"
echo ""
echo "  This generates a CSV in benchmarks/results/"
echo "  Add the CSV + a summary table to the README"

# ──────────────────────────────────────────────
# STEP 3: Run chaos tests (+0.5)
# ──────────────────────────────────────────────
echo ""
echo "Step 3: Run chaos test suite"
echo "  cd packages/core"
echo "  npx tsx tests/chaos-network.test.ts"
echo ""
echo "  All tests should pass. Add results to README."

# ──────────────────────────────────────────────
# STEP 4: Run killer demo (+0.3)
# ──────────────────────────────────────────────
echo ""
echo "Step 4: Run distributed image processing demo"
echo "  cd packages"
echo "  npx tsx demos/distributed-image-processing.ts"
echo ""
echo "  Record terminal output or screen recording for GitHub."

# ──────────────────────────────────────────────
# STEP 5: Update GitHub README (+0.3)
# ──────────────────────────────────────────────
echo ""
echo "Step 5: Replace root README.md with GITHUB-README-v5.md"
echo "  cp packages/GITHUB-README-v5.md README.md"
echo "  Add benchmark results from Step 2"
echo "  Add chaos test badge from Step 3"

# ──────────────────────────────────────────────
# STEP 6: Publish to npm (+0.3)
# ──────────────────────────────────────────────
echo ""
echo "Step 6: Publish to npm"
echo "  cd packages/core"
echo "  cp package.v5.json package.json"
echo "  cp NPM-README.md README.md"
echo "  npm login"
echo "  npm publish --access public"
echo ""
echo "  Verify: npm info @agent-viscro/cmp"

# ──────────────────────────────────────────────
# STEP 7: Real LAN test (+0.4 bonus)
# ──────────────────────────────────────────────
echo ""
echo "Step 7: (BONUS) Real multi-machine LAN test"
echo "  On Machine A: npx tsx examples/04-two-node-compute.ts"
echo "  On Machine B: npx tsx examples/04-two-node-compute.ts"
echo "  Record terminal output showing cross-machine discovery"
echo "  and distributed computation. Upload to YouTube."
echo ""
echo "═══════════════════════════════════════════════"
echo "  Total: 6.5 → 8.7 (estimated)"
echo "═══════════════════════════════════════════════"

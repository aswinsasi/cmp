#!/bin/bash
# CMP Repo Hygiene Cleanup
# Run from cmp/ project root
#
# Removes: calc.php, test.php, cert-*.json, mers.json, security-fix.patch
# Fixes: .gitignore, removes node_modules from git tracking
#
# Run: bash packages/cleanup.sh

set -e

echo "=== CMP Repo Cleanup ==="
echo ""

# 1. Remove junk files from root
echo "[1/4] Removing junk files from root..."
for f in calc.php test.php security-fix.patch mers.json; do
  if [ -f "$f" ]; then
    git rm --cached "$f" 2>/dev/null || true
    rm -f "$f"
    echo "  Removed: $f"
  fi
done

# Remove cert files
for f in cert-*.json; do
  if [ -f "$f" ]; then
    git rm --cached "$f" 2>/dev/null || true
    rm -f "$f"
    echo "  Removed: $f"
  fi
done

# Also check packages/cli/ for cert files
for f in packages/cli/cert-*.json; do
  if [ -f "$f" ]; then
    git rm --cached "$f" 2>/dev/null || true
    rm -f "$f"
    echo "  Removed: $f"
  fi
done

# 2. Remove node_modules from git tracking
echo ""
echo "[2/4] Removing node_modules from git tracking..."
if git ls-files --error-unmatch node_modules/ > /dev/null 2>&1; then
  git rm -r --cached node_modules/ 2>/dev/null || true
  echo "  Removed node_modules/ from git"
else
  echo "  node_modules/ already untracked"
fi

# 3. Update .gitignore
echo ""
echo "[3/4] Updating .gitignore..."
ADDITIONS=(
  "node_modules/"
  "cmp-data/*.db"
  "cert-*.json"
  "mers.json"
  "*.php"
  "security-fix.patch"
  ".DS_Store"
  "dist/"
  "*.db"
)

for line in "${ADDITIONS[@]}"; do
  if ! grep -qxF "$line" .gitignore 2>/dev/null; then
    echo "$line" >> .gitignore
    echo "  Added to .gitignore: $line"
  fi
done

# 4. Add .nvmrc
echo ""
echo "[4/4] Creating .nvmrc..."
echo "18" > .nvmrc
echo "  Created .nvmrc (Node 18)"

echo ""
echo "=== Done! ==="
echo ""
echo "Next steps:"
echo "  git add -A"
echo "  git commit -m 'chore: repo hygiene cleanup'"
echo "  git push"
echo ""
echo "Then update README.md:"
echo "  - Change version badge to 3.0"
echo "  - Change lines badge to ~78,000+"
echo "  - Change tests badge to 1,000+"
echo "  - Change layers badge to 16"
echo "  - Add v3.0 features to Architecture section"
echo "  - Add v3.0 CLI commands to help text"

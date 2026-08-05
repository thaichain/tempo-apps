#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🚀 Deploying og-thaichain..."
pnpm exec wrangler deploy --env thaichain

echo "✅ Deploy complete!"
echo "🌐 URL: https://og.thaichain.org"

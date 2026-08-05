#!/usr/bin/env bash
# Deploy explorer-thaichain using the Vite build + wrangler.json patch flow.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "🔨 Building explorer (thaichain)..."
CLOUDFLARE_ENV='thaichain' VITE_TEMPO_ENV='thaichain' NODE_ENV='production' \
	pnpm exec vite build --mode='thaichain'

echo "📝 Patching dist/server/wrangler.json for thaichain..."
THAICHAIN_NAME=$(jq -r '.env.thaichain.name' wrangler.json)
THAICHAIN_VARS=$(jq '.env.thaichain.vars' wrangler.json)
THAICHAIN_ROUTES=$(jq '.env.thaichain.routes' wrangler.json)

# Merge env-specific name/vars/routes into the built wrangler config.
jq \
	--arg name "$THAICHAIN_NAME" \
	--argjson vars "$THAICHAIN_VARS" \
	--argjson routes "$THAICHAIN_ROUTES" \
	'.name = $name | .vars = $vars | .triggers.routes = $routes' \
	dist/server/wrangler.json > dist/server/wrangler-thaichain.json

echo "🚀 Deploying $THAICHAIN_NAME..."
pnpm exec wrangler deploy --config dist/server/wrangler-thaichain.json

echo "✅ Deploy complete!"
echo "🌐 URL: https://exp.thaichain.org"

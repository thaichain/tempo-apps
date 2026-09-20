#!/usr/bin/env bash

# This file exists because wrangler.json#build does not apply when using Vite

set -euo pipefail

env_name="${CLOUDFLARE_ENV:-${VITE_TEMPO_ENV:-${npm_config_env:-}}}"

if [[ -z "$env_name" ]]; then
	echo "Build requires CLOUDFLARE_ENV, VITE_TEMPO_ENV, or npm_config_env to be set" >&2
	exit 1
fi

case "$env_name" in
	devnet|nextfork|testnet|mainnet|thaichain) ;;
	*)
		echo "Unsupported env: $env_name" >&2
		exit 1
		;;
esac

export CLOUDFLARE_ENV="$env_name"
export VITE_TEMPO_ENV="$env_name"
export NODE_ENV="production"

# Vite bakes import.meta.env at build time — runtime wrangler vars are NOT visible
# to the bundles. Inline every VITE_* var from the env's wrangler block so e.g.
# VITE_CONTRACT_VERIFICATION_API_BASE_URL doesn't fall back to the upstream default.
while IFS='=' read -r key value; do
	[[ -n "$key" ]] && export "$key=$value"
done < <(jq -r --arg e "$env_name" \
	'(.env[$e].vars // {}) | to_entries[] | select(.key | startswith("VITE_")) | "\(.key)=\(.value)"' \
	"$(dirname "$0")/../wrangler.json")

pnpm vite build --mode="$env_name"

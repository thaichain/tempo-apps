# Pakxe Explorer Deployment — Session Summary

## Overview

Deployed Tempo Explorer (forked from tempoxyz/tempo-apps) for the Pakxe blockchain on Cloudflare Workers. The work involved adding a new chain environment, rolling back an incompatible API migration, upgrading external services, and rebranding.

**Repo:** `git@github.com:pakxenet/apps.git` (branch: `main`)
**Explorer URL:** https://exp.pakxe.net
**Worker name:** `explorer-pakxe`
**Deployed via:** `bash deploy-pakxe.sh` (custom script that patches `dist/server/wrangler.json`)

---

## Pakxe Chain Details

| Item | Value |
|------|-------|
| Chain ID | `3773` |
| RPC URL | `https://rpc.pakxe.net` |
| Fee Token | `0x20c0000000000000000000000000000000000000` |
| Explorer domain | `https://exp.pakxe.net` |
| tidx (indexer) | `https://tidx.pakxe.net` |
| Contract verification | `https://contracts.pakxe.net` |
| Tokenlist | `https://tokenlist.pakxe.net` |
| Cloudflare zone | `pakxe.net` (account: Tokenine) |

---

## Key Technical Decisions

### 1. Rolled back explorer to commit `e69852c7` (pre-Tempo-API migration)

The explorer at HEAD (`97f14b46`) had migrated its data layer to the Tempo API (commit `e8b39dfa` — "migrate data layer to Tempo API"). This migration replaced direct tidx SQL queries with `api.v1.transactions.$get` and other Tempo API endpoints. Since the Tempo API is not open source and doesn't know about chain ID 3773, we rolled back the explorer `apps/explorer/` directory to the parent of that commit (`e69852c7`), which still queries tidx directly via SQL.

```bash
git checkout e69852c7 -- apps/explorer
```

**Key difference:**
- **Old explorer (pre-e8b39dfa):** Queries tidx directly via `tidx.ts` + Kysely SQL query builder. Works with standalone tidx deployments.
- **New explorer (post-e8b39dfa):** Uses Tempo API (`api.tempo.xyz/v1/transactions`). Requires Tempo API service (not open source).

### 2. tidx must support event signature decoding

The explorer queries virtual tables like `transfer` and `tokencreated` which are generated on-the-fly from event logs using ABI signatures. The tidx parameter `?signature=Transfer(address,address,uint256)` creates a CTE that decodes logs into queryable rows.

**User upgraded `tidx.pakxe.net`** from an older version to the latest from `https://github.com/tempoxyz/tidx` to support this feature.

### 3. tidx base URL hardcoded

`src/lib/server/tempo-queries-provider.ts` has `baseUrl` hardcoded to `'https://tidx.pakxe.net'` (not read from `process.env`) because Cloudflare Workers `vars` are injected into the request `env` parameter, not `process.env` at module load time.

### 4. Custom deploy script (`deploy-pakxe.sh`)

The standard `wrangler deploy --env pakxe` doesn't work correctly because:
- pnpm 10 intercepts `pnpm deploy` as a built-in command
- The Vite build generates `dist/server/wrangler.json` without environment-specific config

`deploy-pakxe.sh` solves this by:
1. Building with `CLOUDFLARE_ENV=pakxe VITE_TEMPO_ENV=pakxe`
2. Patching `dist/server/wrangler.json` with jq to inject pakxe-specific name, vars, routes, and KV namespace
3. Running `wrangler deploy --config dist/server/wrangler-pakxe.json`

### 5. Contract verification uses simplified schema

The new explorer's `parseRawContractSourceResponse` with `RawContractVerificationLookupSchema` (supporting verified + native contract kinds) failed with the pakxe contract verification service. We replaced it with the simpler `ContractVerificationLookupSchema` from otterevm that directly matches the API response shape.

---

## Files Modified

### Chain & Environment Configuration
| File | Change |
|------|--------|
| `src/lib/chains.ts` | Added `tempoPakxe` chain (ID 3773, RPC, fee token) using `defineChain()` |
| `src/lib/env.ts` | Added `'pakxe'` to `TempoEnv` type, hostname inference (`exp.pakxe.`), `normalizeTempoEnv()` |
| `env.d.ts` | Added `'pakxe'` to `VITE_TEMPO_ENV` union, added `TIDX_BASE_URL` type |
| `src/lib/build-env.ts` | Added `z.literal('pakxe')` to `canonicalTempoEnvSchema` |
| `src/wagmi.config.ts` | Added `tempoPakxe` to `getTempoChain()`, bypass Tempo RPC proxy for Pakxe (use direct RPC) |
| `wrangler.json` | Added `pakxe` env block (worker name, routes, vars, KV namespace). Removed top-level `kv_namespaces`. |
| `src/lib/fee-token.ts` | Added `3773: '0x20c0...'` to `FEE_TOKEN_BY_CHAIN_ID` |
| `src/lib/explorer-network.ts` | Replaced mainnet/testnet options with Pakxe-only |

### tidx / Data Layer
| File | Change |
|------|--------|
| `src/lib/server/tempo-queries-provider.ts` | Hardcoded `baseUrl: 'https://tidx.pakxe.net'` |
| `src/lib/server/env.ts` | Added `TIDX_BASE_URL` to schema (from pre-migration version) |
| `src/lib/server/tempo-api.ts` | **Deleted** (Tempo API client, not needed) |
| `src/lib/server/verified-tokens.ts` | **Deleted** (uses Tempo API) |
| `src/routes/api/token/logo/$address.ts` | **Deleted** (uses Tempo API) |
| `src/routes/api/verified-tokens.ts` | **Deleted** (uses Tempo API) |
| `test/address-history.node.test.ts` | **Deleted** (tests for Tempo API version) |
| `test/token.node.test.ts` | **Deleted** (tests for Tempo API version) |

### Contract Verification
| File | Change |
|------|--------|
| `src/routes/api/code.ts` | Rewritten to match otterevm style: hardcoded `contracts.pakxe.net`, uses `ContractVerificationLookupSchema`, requests only `stdJsonInput,abi,compilation` fields |
| `src/lib/domain/contract-source.ts` | Added `ContractVerificationLookupSchema` export (simple schema matching API response) |

### Tokenlist
| File | Change |
|------|--------|
| `src/lib/tokenlist.ts` | Changed `TOKENLIST_BASE_URL` to `https://tokenlist.pakxe.net`, added chain ID 3773 to `TOKENLIST_URLS` and `FEE_TOKEN_BY_CHAIN_ID` |

### Branding (Tempo → Pakxe)
| File | Change |
|------|--------|
| `src/comps/Header.tsx` | Replaced `TempoWordmark` SVG with `PakxeWordmark` using `<img src="/logo.svg">` |
| `src/comps/Footer.tsx` | Links: About → `pakxe.net`, GitHub → `pakxenet/`. Removed Docs and Feedback |
| `src/comps/ConnectWallet.tsx` | "Add Tempo" → "Add Pakxe", nativeCurrency: PAK (18 decimals) |
| `src/comps/WalletActions.tsx` | "Switch to Tempo" → "Switch to Pakxe", nativeCurrency: PAK (18 decimals) |
| `src/routes/__root.tsx` | Title → "Pakxe Explorer", updated meta description, favicon links |
| `public/logo.svg` | Pakxe logo SVG |
| `public/favicon.png` | Pakxe favicon (32x32) |
| `public/favicon-32x32.png` | Pakxe favicon (32x32) |
| `public/favicon-16x16.png` | Pakxe favicon (16x16) |

### CORS
| File | Change |
|------|--------|
| `src/index.server.ts` | Added CORS middleware: allows `pakxe.net`, `wallet.pakxe.net`, `exp.pakxe.net`. Handles OPTIONS preflight + adds headers to `/api/*` responses |

### Build & Deploy Scripts
| File | Change |
|------|--------|
| `scripts/build.sh` | Added `pakxe` to valid envs |
| `scripts/deploy.sh` | Added `pakxe` to valid envs |
| `package.json` | Added `dev:pakxe` and `deploy:pakxe` scripts |
| `.env.example` | Added `TIDX_BASE_URL` documentation |
| `deploy-pakxe.sh` | **New** — custom deploy script for pakxe environment |

---

## Cloudflare Resources

- **Worker:** `explorer-pakxe` (account: Tokenine, ID: `b39d91b4579b45c988fc9e31ef98fad1`)
- **Custom domain:** `exp.pakxe.net` (zone: `pakxe.net`)
- **KV namespace:** `EXPLORER_FEE_AMM_CACHE` (ID: `25b0a8a2afd04402be1fe2a9c5b2f007`)
- **Auth:** OAuth via `wrangler login` (no API token needed)

---

## Deploy Command

```bash
cd /Users/dome/project/pakxe/tempo-apps/apps/explorer
bash deploy-pakxe.sh
```

This builds with `CLOUDFLARE_ENV=pakxe`, patches the wrangler config, and deploys.

---

## External Services (deployed by user separately)

| Service | URL | Notes |
|---------|-----|-------|
| **tidx** | `tidx.pakxe.net` | Upgraded to latest from github.com/tempoxyz/tidx. Must support `?signature=` for event decoding. |
| **Contract verification** | `contracts.pakxe.net` | API: `/v2/contract/{chainId}/{address}?fields=stdJsonInput,abi,compilation` |
| **Tokenlist** | `tokenlist.pakxe.net` | Serves `/list/3773` with token metadata |
| **RPC node** | `rpc.pakxe.net` | Chain ID 3773 JSON-RPC endpoint |

---

## Reference: otterevm (PaysoNow)

The otterevm deployment at `/Users/dome/project/otterevm/tempo-apps-dev/` was used as a reference implementation throughout. It's an older fork of tempo-apps that successfully deploys against a standalone tidx instance.

- **Explorer:** `https://exp.payidx.com`
- **Worker:** `explorer-paysonow`
- **tidx:** `tidx.paysonow.com`
- **Chain ID:** 3773 (same chain, same RPC)

---

## Known Limitations / Future Work

1. **Tokenlist app not updated** — The `apps/tokenlist` service still uses Tempo API (`api.tempo.xyz/v1/tokenlist`). The explorer works around this by pointing `TOKENLIST_BASE_URL` to `tokenlist.pakxe.net` (the existing otterevm deployment). If a dedicated pakxe tokenlist worker is needed, it should be forked from the otterevm version (which reads from static files instead of Tempo API).

2. **Tempo branding remnants** — Some internal code still references "Tempo" (variable names like `tempoEnv`, `TempoEnv` type, `getTempoChain()`, SVG aria-labels). These are cosmetic and don't affect functionality.

3. **PostHog analytics** — The explorer still loads PostHog with Tempo's project key (`phc_aNlTw2xAUQKd9zTovXeYheEUpQpEhplehCK5r1e31HR`). Should be replaced or removed for Pakxe.

4. **OG image service** — Still points to `og.tempo.xyz`. Would need a Pakxe OG image service for social sharing previews.

5. **Fee AMM** — Uses a KV namespace cache (`EXPLORER_FEE_AMM_CACHE`). The fee-amm feature may not work correctly if the chain doesn't have the expected AMM contracts.

6. **tidx tables** — The explorer queries these tidx tables: `blocks`, `txs`, `logs`, `receipts`, `transfer` (virtual via signature), `tokencreated` (virtual via signature). Ensure tidx sync covers all of these.

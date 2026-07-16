import { createIsomorphicFn, createServerFn } from '@tanstack/react-start'
import { getRequestHeader } from '@tanstack/react-start/server'
import { createPublicClient } from 'viem'
import { tempoDevnet, tempoLocalnet } from 'viem/chains'
import { tempoActions } from 'viem/tempo'
import { loadBalance, rateLimit } from '@tempo/rpc-utils'
import {
	tempoMainnet,
	tempoNextfork,
	tempoTestnet,
	thaiChain,
} from './lib/chains'
import { getTempoEnv } from './lib/env'
import {
	cookieStorage,
	cookieToInitialState,
	createConfig,
	createStorage,
	http,
	serialize,
} from 'wagmi'
import { tempoWallet } from 'wagmi/connectors'

export type WagmiConfig = ReturnType<typeof getWagmiConfig>
let wagmiConfigSingleton: ReturnType<typeof createConfig> | null = null

export const getTempoChain = createIsomorphicFn()
	.client(() =>
		getTempoEnv() === 'thaichain'
			? thaiChain
			: getTempoEnv() === 'mainnet'
				? tempoMainnet
				: getTempoEnv() === 'nextfork'
					? tempoNextfork
					: getTempoEnv() === 'devnet'
						? tempoDevnet
						: getTempoEnv() === 'testnet'
							? tempoTestnet
							: thaiChain,
	)
	.server(() =>
		getTempoEnv() === 'thaichain'
			? thaiChain
			: getTempoEnv() === 'mainnet'
				? tempoMainnet
				: getTempoEnv() === 'nextfork'
					? tempoNextfork
					: getTempoEnv() === 'devnet'
						? tempoDevnet
						: getTempoEnv() === 'testnet'
							? tempoTestnet
							: thaiChain,
	)

// Thaichain (ID 7) uses direct RPC; Tempo chains go through proxy.tempo.xyz.
function isDirectRpc(chainId: number) {
	return chainId === thaiChain.id
}

const getRpcTransport = createIsomorphicFn()
	.client(() => {
		const chain = getTempoChain()

		// Thaichain: direct RPC, no Tempo proxy.
		if (isDirectRpc(chain.id)) {
			return loadBalance(
				chain.rpcUrls.default.http.map((url) =>
					rateLimit(http(url), { requestsPerSecond: 20 }),
				),
			)
		}

		// Tempo: browser traffic must hit the Tempo RPC proxy.
		return loadBalance([
			rateLimit(http(`https://proxy.tempo.xyz/rpc/${chain.id}`), {
				requestsPerSecond: 20,
			}),
		])
	})
	.server(() => {
		const chain = getTempoChain()

		// Thaichain: direct RPC + fallbacks.
		if (isDirectRpc(chain.id)) {
			return loadBalance(chain.rpcUrls.default.http.map((url) => http(url)))
		}

		// Tempo: proxy + direct chain RPC fallback.
		return loadBalance([
			http(`https://proxy.tempo.xyz/rpc/${chain.id}`),
			...chain.rpcUrls.default.http.map((url) => http(url)),
		])
	})

export function getWagmiConfig() {
	if (wagmiConfigSingleton) return wagmiConfigSingleton
	const chain = getTempoChain()
	const transport = getRpcTransport()

	wagmiConfigSingleton = createConfig({
		ssr: true,
		multiInjectedProviderDiscovery: true,
		chains: [chain, tempoLocalnet],
		connectors: [tempoWallet()],
		storage: createStorage({ storage: cookieStorage }),
		transports: {
			[chain.id]: transport,
			[tempoLocalnet.id]: http(undefined, { batch: true }),
		} as never,
	})

	return wagmiConfigSingleton
}

export const getWagmiStateSSR = createServerFn().handler(() => {
	const cookie = getRequestHeader('cookie')
	const initialState = cookieToInitialState(getWagmiConfig(), cookie)
	return serialize(initialState || {})
})

// Batched HTTP client for bulk RPC operations
export function getBatchedClient() {
	const chain = getTempoChain()
	const transport = getRpcTransport()

	return createPublicClient({ chain, transport }).extend(tempoActions())
}

declare module 'wagmi' {
	interface Register {
		config: ReturnType<typeof getWagmiConfig>
	}
}

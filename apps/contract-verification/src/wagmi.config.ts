import {
	tempoDevnet,
	tempo as tempoMainnet,
	tempoModerato as tempoTestnet,
} from '@wagmi/core/chains'
import { defineChain } from 'viem'

const verifierUrl =
	import.meta.env?.VITE_VERIFIER_URL ?? 'https://contracts.tempo.xyz'

export const tempoMainnetExtended = tempoMainnet.extend({
	verifierUrl,
	feeToken: '0x20c0000000000000000000000000000000000000',
})

export const tempoDevnetExtended = tempoDevnet.extend({
	verifierUrl,
	feeToken: '0x20c0000000000000000000000000000000000000',
})

export const tempoTestnetExtended = tempoTestnet.extend({
	verifierUrl,
	feeToken: '0x20c0000000000000000000000000000000000001',
})

export const thaifiExtended = defineChain({
	id: 17,
	name: 'ThaiFi',
	nativeCurrency: {
		name: 'pathUSD',
		symbol: 'pathUSD',
		decimals: 6,
	},
	rpcUrls: {
		default: {
			http: ['https://tidx.pakxe.net/thaifi/rpc'],
		},
	},
	blockExplorers: {
		default: {
			name: 'ThaiFi Explorer',
			url: 'https://explorer-thaifi.tokenine.workers.dev',
		},
	},
	feeToken: '0x20c0000000000000000000000000000000000000',
})

export const thaichainExtended = defineChain({
	id: 7,
	name: 'Thaichain',
	nativeCurrency: {
		name: 'THAI',
		symbol: 'THAI',
		decimals: 18,
	},
	rpcUrls: {
		default: {
			http: ['https://rpc.thaichain.org'],
		},
	},
	blockExplorers: {
		default: {
			name: 'Thaichain Explorer',
			url: 'https://exp.thaichain.org',
		},
	},
	feeToken: '0x20c0000000000000000000000000000000000000',
})

/** Static chains -- always available, cannot be overridden by dynamic config. */
export const staticChains = [
	tempoDevnetExtended,
	tempoTestnetExtended,
	tempoMainnetExtended,
	thaifiExtended,
	thaichainExtended,
] as const

export const chainFeeTokens = {
	[tempoDevnet.id]: tempoDevnetExtended.feeToken,
	[tempoTestnet.id]: tempoTestnetExtended.feeToken,
	[tempoMainnet.id]: tempoMainnetExtended.feeToken,
	[17]: thaifiExtended.feeToken,
	[7]: thaichainExtended.feeToken,
} as const

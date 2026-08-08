import { env } from 'cloudflare:workers'
import { defineChain } from 'viem'
import { tempo, tempoDevnet, tempoLocalnet, tempoModerato } from 'viem/chains'
import { alphaUsd, pathUsd, tchToken } from './consts.js'

type CanonicalTempoEnv = 'devnet' | 'localnet' | 'mainnet' | 'moderato' | 'thaichain'
type TempoEnv = CanonicalTempoEnv | 'testnet'

// ThaiChain (chain ID 7) — Tempo-compatible chain with feeToken
export const thaichain = defineChain({
	id: 7,
	name: 'ThaiChain',
	nativeCurrency: { name: 'ThaiChain TCH', symbol: 'TCH', decimals: 18 },
	rpcUrls: {
		default: { http: ['https://rpc.thaichain.org'] },
	},
	blockExplorers: {
		default: {
			name: 'ThaiChain Explorer',
			url: 'https://exp.thaichain.org',
		},
	},
	// Extend with feeToken directly in defineChain
	feeToken: tchToken,
})

// Chains with feeToken already extended
const chainsWithFeeToken = {
	devnet: tempoDevnet.extend({ feeToken: alphaUsd }),
	localnet: tempoLocalnet.extend({ feeToken: alphaUsd }),
	mainnet: tempo.extend({ feeToken: pathUsd }),
	moderato: tempoModerato.extend({ feeToken: alphaUsd }),
	thaichain: thaichain, // already has feeToken
} as const

const rawTempoEnv = (env.TEMPO_ENV as TempoEnv | undefined) ?? 'moderato'
const tempoEnv: CanonicalTempoEnv =
	rawTempoEnv === 'testnet' ? 'moderato' : rawTempoEnv

export const tempoChain = chainsWithFeeToken[tempoEnv]

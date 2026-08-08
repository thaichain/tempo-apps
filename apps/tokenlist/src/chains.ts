import { defineChain } from 'viem'
import { tempoDevnet, tempoModerato as tempoTestnet, tempo } from 'viem/chains'

export const tempoMainnet = tempo.extend({
	feeToken: '0x20c0000000000000000000000000000000000000',
})

export const paysonow = defineChain({
	id: 3773,
	name: 'PaysoNow',
	nativeCurrency: {
		name: 'PUSD',
		symbol: 'PUSD',
		decimals: 6,
	},
	rpcUrls: {
		default: {
			http: ['https://rpc.paysonow.com'],
		},
	},
	feeToken: '0x20c0000000000000000000000000000000000000',
})

export const thaiChain = defineChain({
	id: 7,
	name: 'ThaiChain',
	nativeCurrency: {
		name: 'TCH TOKEN',
		symbol: 'TCH',
		decimals: 6,
	},
	rpcUrls: {
		default: {
			http: ['https://rpc.thaichain.org'],
		},
	},
	feeToken: '0x20c0000000000000000000000000000000000000',
})

export const yourChain = defineChain({
	id: 7447,
	name: 'Your Chain',
	nativeCurrency: {
		name: 'FEE',
		symbol: 'FEE',
		decimals: 18,
	},
	rpcUrls: {
		default: {
			http: ['https://rpc.your-chain.com'],
		},
	},
})

export const CHAIN_IDS = [
	tempoDevnet.id,
	tempoTestnet.id,
	tempoMainnet.id,
	paysonow.id,
	thaiChain.id,
	yourChain.id,
] as const

export const chains = {
	[tempoDevnet.id]: tempoDevnet,
	[tempoTestnet.id]: tempoTestnet,
	[tempoMainnet.id]: tempoMainnet,
	[paysonow.id]: paysonow,
	[thaiChain.id]: thaiChain,
	[yourChain.id]: yourChain,
}

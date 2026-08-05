import type { Address } from 'ox'
import type { Log } from 'viem'
import { parseEventLogs } from 'viem'
import { readContract } from 'wagmi/actions'
import { Abis } from '#lib/abis'
import { Actions } from 'wagmi/tempo'
import type { Config } from 'wagmi'
import { getWagmiConfig } from '#wagmi.config.ts'

const abi = Object.values(Abis).flat()

const tip20Prefix = '0x20c000000'
export type Tip20Address = `${typeof tip20Prefix}${string}`
export function isTip20Address(address: string): address is Tip20Address {
	return address.toLowerCase().startsWith(tip20Prefix)
}

export type Metadata = Actions.token.getMetadata.ReturnValue

export type GetTip20MetadataFn = (
	address: Address.Address,
) => Metadata | undefined

export const logoUriAbi = [
	{
		type: 'function',
		name: 'logoURI',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ type: 'string' }],
	},
] as const

const erc20MetadataAbi = [
	{
		type: 'function',
		name: 'symbol',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ type: 'string' }],
	},
	{
		type: 'function',
		name: 'decimals',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ type: 'uint8' }],
	},
	{
		type: 'function',
		name: 'name',
		stateMutability: 'view',
		inputs: [],
		outputs: [{ type: 'string' }],
	},
] as const

export function resolveLogoURI(logoURI: string | null | undefined) {
	if (!logoURI) return undefined
	const trimmed = logoURI.trim()
	if (!trimmed) return undefined

	if (trimmed.startsWith('ipfs://')) {
		const path = trimmed.slice('ipfs://'.length).replace(/^ipfs\//, '')
		if (!path) return undefined
		return `https://ipfs.io/ipfs/${path}`
	}

	return trimmed
}

export async function fetchLogoURI(
	config: Config,
	token: Address.Address,
): Promise<string | undefined> {
	const logoURI = await readContract(config, {
		address: token,
		abi: logoUriAbi,
		functionName: 'logoURI',
	}).catch(() => undefined)

	return typeof logoURI === 'string' ? logoURI : undefined
}

/**
 * Fetches token metadata using standard ERC20 calls (symbol, decimals, name).
 * Falls back gracefully if any call fails.
 * Replaces the Tempo-specific Actions.token.getMetadata which doesn't work on ThaiChain.
 */
async function getStandardTokenMetadata(
	config: Config,
	token: Address.Address,
): Promise<Metadata> {
	const [symbol, decimals, name] = await Promise.all([
		readContract(config, {
			address: token,
			abi: erc20MetadataAbi,
			functionName: 'symbol',
		}).catch(() => ''),
		readContract(config, {
			address: token,
			abi: erc20MetadataAbi,
			functionName: 'decimals',
		}).catch(() => 18),
		readContract(config, {
			address: token,
			abi: erc20MetadataAbi,
			functionName: 'name',
		}).catch(() => ''),
	])

	return {
		symbol: (symbol as string) || '',
		decimals: Number(decimals),
		name: (name as string) || '',
		currency: '',
		totalSupply: '0',
	} as Metadata
}

export async function metadataFromLogs(
	logs: Log[],
): Promise<GetTip20MetadataFn> {
	const events = parseEventLogs({ abi, logs })

	const tip20Addresses = events
		.map(({ address }) => address)
		.filter(isTip20Address)

	const config = getWagmiConfig()

	// Use standard ERC20 calls instead of Tempo-specific precompile
	const metadataResults = await Promise.all(
		tip20Addresses.map((token) =>
			getStandardTokenMetadata(config as Config, token as Address.Address).catch(
				() => undefined as unknown as Metadata,
			),
		),
	)
	const map = new Map<string, Metadata>()
	for (const [index, address] of tip20Addresses.entries()) {
		const metadata = metadataResults[index]
		if (metadata) map.set(address.toLowerCase(), metadata)
	}

	return (address: Address.Address) => map.get(address.toLowerCase())
}

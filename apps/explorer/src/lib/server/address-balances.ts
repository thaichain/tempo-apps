import { createServerFn } from '@tanstack/react-start'
import type { Address } from 'ox'
import { formatUnits } from 'viem'
import { readContract } from 'wagmi/actions'
import { getChainId } from 'wagmi/actions'
import type { Config } from 'wagmi'

import type { BalancesResponse, TokenBalance } from '#lib/address-balances'
import {
	buildCsv,
	createCsvDownloadResponse,
	createTimestampedCsvFilename,
} from '#lib/server/csv'
import { tempoQueryBuilder } from '#lib/server/tempo-queries-provider'
import { zAddress } from '#lib/zod'
import { getWagmiConfig } from '#wagmi.config.ts'

const QB = tempoQueryBuilder

const TRANSFER_SIGNATURE =
	'event Transfer(address indexed from, address indexed to, uint256 tokens)'

export const TIP20_DECIMALS = 6
export const MAX_TOKENS = 50

export function createBalancesCsvResponse(params: {
	address: Address.Address
	balances: ReadonlyArray<TokenBalance>
}): Response {
	const rows: Array<ReadonlyArray<unknown>> = [
		[
			'token_address',
			'symbol',
			'name',
			'currency',
			'decimals',
			'balance_raw',
			'balance_formatted',
		],
	]

	for (const balance of params.balances) {
		const decimals = balance.decimals ?? TIP20_DECIMALS
		const rawBalance = BigInt(balance.balance)
		rows.push([
			balance.token,
			balance.symbol,
			balance.name,
			balance.currency,
			decimals,
			rawBalance.toString(),
			formatUnits(rawBalance, decimals),
		])
	}

	return createCsvDownloadResponse({
		csv: buildCsv(rows),
		filename: createTimestampedCsvFilename('balances', params.address),
		headers: {
			'X-Tempo-Export-Row-Limit': String(MAX_TOKENS),
		},
	})
}

const erc20Abi = [
	{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
	{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
	{ type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

// Cache token metadata per token address
const metadataCache = new Map<string, { symbol: string; decimals: number; name: string; timestamp: number }>()
const METADATA_CACHE_TTL = 300_000

async function getTokenMetadata(
	tokenAddress: string,
	config: Config,
): Promise<{ symbol: string; decimals: number; name: string }> {
	const cached = metadataCache.get(tokenAddress)
	if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL) return cached

	try {
		const [symbol, decimals, name] = await Promise.all([
			readContract(config, { address: tokenAddress as Address.Address, abi: erc20Abi, functionName: 'symbol' }).catch(() => ''),
			readContract(config, { address: tokenAddress as Address.Address, abi: erc20Abi, functionName: 'decimals' }).catch(() => 18),
			readContract(config, { address: tokenAddress as Address.Address, abi: erc20Abi, functionName: 'name' }).catch(() => ''),
		])

		const entry = {
			symbol: (symbol as string) || '',
			decimals: Number(decimals),
			name: (name as string) || '',
			timestamp: Date.now(),
		}
		metadataCache.set(tokenAddress, entry)
		return entry
	} catch {
		return { symbol: '', decimals: 18, name: '' }
	}
}

/**
 * Fetches address token balances from tidx Transfer events.
 * Aggregates inflows minus outflows per token.
 */
export async function fetchAddressBalancesData(params: {
	address: Address.Address
	chainId: number
	maxTokens?: number | undefined
}): Promise<BalancesResponse> {
	const { address, chainId } = params
	const maxTokens = params.maxTokens ?? MAX_TOKENS
	const addr = address.toLowerCase()

	try {
		// Inflows (transfers TO this address)
		const inflows = (await QB(chainId)
			.withSignatures([TRANSFER_SIGNATURE])
			.selectFrom('transfer')
			.select((eb) => [
				eb.ref('address').as('token'),
				eb.fn.sum('tokens').as('total'),
			])
			.where('to', '=', addr)
			.groupBy('address')
			.execute()) as Array<{ token: string; total: bigint }>

		// Outflows (transfers FROM this address)
		const outflows = (await QB(chainId)
			.withSignatures([TRANSFER_SIGNATURE])
			.selectFrom('transfer')
			.select((eb) => [
				eb.ref('address').as('token'),
				eb.fn.sum('tokens').as('total'),
			])
			.where('from', '=', addr)
			.groupBy('address')
			.execute()) as Array<{ token: string; total: bigint }>

		// Compute net balances
		const balances = new Map<string, bigint>()
		for (const { token, total } of inflows) {
			balances.set(token, (balances.get(token) ?? 0n) + BigInt(total))
		}
		for (const { token, total } of outflows) {
			balances.set(token, (balances.get(token) ?? 0n) - BigInt(total))
		}

		// Filter positive balances, sorted by balance desc
		const positiveBalances = [...balances.entries()]
			.filter(([, balance]) => balance > 0n)
			.sort((a, b) => (b[1] > a[1] ? 1 : -1))
			.slice(0, maxTokens)

		// Fetch metadata for each token
		const config = getWagmiConfig()
		const result: TokenBalance[] = await Promise.all(
			positiveBalances.map(async ([token, balance]) => {
				const metadata = await getTokenMetadata(token, config as Config)
				return {
					token: token as Address.Address,
					balance: balance.toString(),
					name: metadata.name,
					symbol: metadata.symbol,
					currency: '',
					decimals: metadata.decimals,
				}
			}),
		)

		return { balances: result }
	} catch (error) {
		console.error('[balances] failed:', error)
		return { balances: [] }
	}
}

export const fetchAddressBalances = createServerFn({ method: 'GET' })
	.inputValidator((input) => zAddress().parse(input))
	.handler(({ data }) =>
		fetchAddressBalancesData({
			address: data,
			chainId: getChainId(getWagmiConfig()),
		}),
	)

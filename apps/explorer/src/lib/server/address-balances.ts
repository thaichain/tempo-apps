import { createServerFn } from '@tanstack/react-start'
import type { Address } from 'ox'
import { formatUnits } from 'viem'
import { getChainId } from 'wagmi/actions'

import type { BalancesResponse, TokenBalance } from '#lib/address-balances'
import {
	buildCsv,
	createCsvDownloadResponse,
	createTimestampedCsvFilename,
} from '#lib/server/csv'
import { zAddress } from '#lib/zod'
import { getWagmiConfig } from '#wagmi.config.ts'

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

/**
 * Stub: Address balances not available without Tempo API.
 * Returns empty balances.
 */
export async function fetchAddressBalancesData(params: {
	address: Address.Address
	chainId: number
	maxTokens?: number | undefined
}): Promise<BalancesResponse> {
	return { balances: [] }
}

export const fetchAddressBalances = createServerFn({ method: 'GET' })
	.inputValidator((input) => zAddress().parse(input))
	.handler(({ data }) =>
		fetchAddressBalancesData({
			address: data,
			chainId: getChainId(getWagmiConfig()),
		}),
	)

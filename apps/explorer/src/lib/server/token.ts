import { createServerFn } from '@tanstack/react-start'
import type { Address, Hex } from 'ox'
import * as z from 'zod/mini'
import { TOKEN_COUNT_MAX } from '#lib/constants'
import { tempoQueryBuilder, tidx } from '#lib/server/tempo-queries-provider'
import { zAddress } from '#lib/zod'

const QB = tempoQueryBuilder
const COUNT_CAP = TOKEN_COUNT_MAX

const TRANSFER_SIGNATURE =
	'event Transfer(address indexed from, address indexed to, uint256 tokens)'

// ===================== Token Holders =====================

const FetchTokenHoldersInputSchema = z.object({
	address: zAddress({ lowercase: true }),
	page: z.coerce.number().check(z.gte(1)),
	limit: z.coerce.number().check(z.gte(5), z.lte(200)),
})

export type FetchTokenHoldersInput = z.infer<
	typeof FetchTokenHoldersInputSchema
>

export type TokenHoldersApiResponse = {
	holders: Array<{
		address: Address.Address
		balance: string
	}>
	total: number
	totalCapped: boolean
	totalBalance: string
}

const EMPTY_HOLDERS_RESPONSE: TokenHoldersApiResponse = {
	holders: [],
	total: 0,
	totalCapped: false,
	totalBalance: '0',
}

type HolderCache = {
	holders: Array<{ address: string; balance: bigint }>
	totalSupply: bigint
	timestamp: number
}
const holdersCache = new Map<string, HolderCache>()
const HOLDERS_CACHE_TTL = 60_000

/**
 * Computes token holder balances from the transfer virtual table.
 * Same approach as the original explorer: tidx virtual table with signatures.
 */
async function computeTokenHolders(
	tokenAddress: string,
	chainId: number,
): Promise<HolderCache> {
	const cached = holdersCache.get(tokenAddress)
	if (cached && Date.now() - cached.timestamp < HOLDERS_CACHE_TTL) return cached

	// Aggregate inflows and outflows via the transfer virtual table
	const inflows = (await QB(chainId)
		.withSignatures([TRANSFER_SIGNATURE])
		.selectFrom('transfer')
		.select((eb) => [eb.ref('to').as('addr'), eb.fn.sum('tokens').as('total')])
		.where('address', '=', tokenAddress)
		.groupBy('to')
		.execute()) as Array<{ addr: string; total: bigint }>

	const outflows = (await QB(chainId)
		.withSignatures([TRANSFER_SIGNATURE])
		.selectFrom('transfer')
		.select((eb) => [eb.ref('from').as('addr'), eb.fn.sum('tokens').as('total')])
		.where('address', '=', tokenAddress)
		.groupBy('from')
		.execute()) as Array<{ addr: string; total: bigint }>

	const balances = new Map<string, bigint>()
	for (const { addr, total } of inflows) {
		balances.set(addr, (balances.get(addr) ?? 0n) + BigInt(total))
	}
	for (const { addr, total } of outflows) {
		balances.set(addr, (balances.get(addr) ?? 0n) - BigInt(total))
	}

	const holders = [...balances.entries()]
		.filter(([, balance]) => balance > 0n)
		.map(([address, balance]) => ({ address, balance }))
		.sort((a, b) => (b.balance > a.balance ? 1 : -1))

	const totalSupply = holders.reduce((sum, h) => sum + h.balance, 0n)
	const entry: HolderCache = { holders, totalSupply, timestamp: Date.now() }
	holdersCache.set(tokenAddress, entry)
	return entry
}

export const fetchHolders = createServerFn({ method: 'POST' })
	.inputValidator((input) => FetchTokenHoldersInputSchema.parse(input))
	.handler(async ({ data }): Promise<TokenHoldersApiResponse> => {
		try {
			if (data.page * data.limit > COUNT_CAP) return EMPTY_HOLDERS_RESPONSE

			const { holders, totalSupply } = await computeTokenHolders(
				data.address,
				7,
			)

			const offset = (data.page - 1) * data.limit
			const pageHolders = holders.slice(offset, offset + data.limit)

			return {
				holders: pageHolders.map((h) => ({
					address: h.address as Address.Address,
					balance: h.balance.toString(),
				})),
				total: holders.length,
				totalCapped: holders.length >= COUNT_CAP,
				totalBalance: totalSupply.toString(),
			}
		} catch (error) {
			console.error('[holders] failed:', error)
			return EMPTY_HOLDERS_RESPONSE
		}
	})

// ===================== resolveTotal =====================

export function resolveTotal(options: {
	exactCount: number | undefined
	exactCountCapped?: boolean | undefined
	page: number
	limit: number
	rows: number
	exhausted: boolean
}): { total: number; totalCapped: boolean } {
	const { exactCount, exactCountCapped, page, limit, rows, exhausted } = options
	const maxNavigableRows = Math.floor(COUNT_CAP / limit) * limit
	if (exactCount !== undefined) {
		const totalCapped =
			Boolean(exactCountCapped) || exactCount > maxNavigableRows
		return {
			total: totalCapped ? maxNavigableRows : exactCount,
			totalCapped,
		}
	}
	if (exhausted)
		return {
			total: Math.min((page - 1) * limit + rows, maxNavigableRows),
			totalCapped: false,
		}
	return { total: maxNavigableRows, totalCapped: true }
}

// ===================== Token Transfers =====================

const FetchTokenTransfersInputSchema = z.object({
	address: zAddress({ lowercase: true }),
	page: z.coerce.number().check(z.gte(1)),
	limit: z.coerce.number().check(z.gte(5), z.lte(200)),
	account: z.optional(zAddress({ lowercase: true })),
})

export type FetchTokenTransfersInput = z.infer<
	typeof FetchTokenTransfersInputSchema
>

export type TokenTransfersApiResponse = {
	transfers: Array<{
		from: Address.Address
		to: Address.Address
		value: string
		transactionHash: Hex.Hex
		blockNumber: string
		timestamp: string | null
	}>
	total: number
	totalCapped: boolean
}

const EMPTY_TRANSFERS_RESPONSE: TokenTransfersApiResponse = {
	transfers: [],
	total: 0,
	totalCapped: false,
}

export const fetchTransfers = createServerFn({ method: 'POST' })
	.inputValidator((input) => FetchTokenTransfersInputSchema.parse(input))
	.handler(async ({ data }): Promise<TokenTransfersApiResponse> => {
		try {
			if (data.page * data.limit > COUNT_CAP) return EMPTY_TRANSFERS_RESPONSE

			const offset = (data.page - 1) * data.limit

			// Count via transfer virtual table
			const countQb = QB(7)
				.withSignatures([TRANSFER_SIGNATURE])
				.selectFrom('transfer')
				.select((eb) => [eb.fn.count('tx_hash').as('c')])
				.where('address', '=', data.address)

			if (data.account) {
				countQb.where((eb) =>
					eb.or([
						eb('from', '=', data.account as string),
						eb('to', '=', data.account as string),
					]),
				)
			}

			const countResult = await countQb.executeTakeFirst()
			const total = Number(
				(countResult as Record<string, unknown>)?.c ?? 0,
			)

			if (total === 0) return EMPTY_TRANSFERS_RESPONSE

			// Data via transfer virtual table
			const dataQb = QB(7)
				.withSignatures([TRANSFER_SIGNATURE])
				.selectFrom('transfer')
				.select([
					'from',
					'to',
					'tokens',
					'tx_hash',
					'block_num',
					'block_timestamp',
				])
				.where('address', '=', data.address)
				.orderBy('block_num', 'desc')
				.limit(data.limit)
				.offset(offset)

			if (data.account) {
				dataQb.where((eb) =>
					eb.or([
						eb('from', '=', data.account as string),
						eb('to', '=', data.account as string),
					]),
				)
			}

			const rows = (await dataQb.execute()) as Array<{
				from: string
				to: string
				tokens: string | bigint
				tx_hash: string
				block_num: string | number | bigint
				block_timestamp: string | null
			}>

			return {
				transfers: rows.map((row) => ({
					from: row.from as Address.Address,
					to: row.to as Address.Address,
					value: BigInt(row.tokens).toString(),
					transactionHash: row.tx_hash as Hex.Hex,
					blockNumber: String(row.block_num),
					timestamp: row.block_timestamp,
				})),
				total,
				totalCapped: total >= COUNT_CAP,
			}
		} catch (error) {
			console.error('[transfers] failed:', error)
			return EMPTY_TRANSFERS_RESPONSE
		}
	})

// ===================== Account Transfers =====================

const FetchAccountTransfersInputSchema = z.object({
	account: zAddress({ lowercase: true }),
	page: z.coerce.number().check(z.gte(1)),
	limit: z.coerce.number().check(z.gte(5), z.lte(200)),
})

export type FetchAccountTransfersInput = z.infer<
	typeof FetchAccountTransfersInputSchema
>

export type AccountTransfersApiResponse = {
	transfers: Array<{
		from: Address.Address
		to: Address.Address
		value: string
		transactionHash: Hex.Hex
		blockNumber: string
		timestamp: string | null
		token: {
			address: Address.Address
			symbol: string
			decimals: number
			currency: string
		}
	}>
	total: number
	totalCapped: boolean
}

const EMPTY_ACCOUNT_TRANSFERS_RESPONSE: AccountTransfersApiResponse = {
	transfers: [],
	total: 0,
	totalCapped: false,
}

export const fetchAccountTransfers = createServerFn({ method: 'POST' })
	.inputValidator((input) => FetchAccountTransfersInputSchema.parse(input))
	.handler(async ({ data }): Promise<AccountTransfersApiResponse> => {
		try {
			if (data.page * data.limit > COUNT_CAP)
				return EMPTY_ACCOUNT_TRANSFERS_RESPONSE

			const offset = (data.page - 1) * data.limit

			// Count
			const countResult = await QB(7)
				.withSignatures([TRANSFER_SIGNATURE])
				.selectFrom('transfer')
				.select((eb) => [eb.fn.count('tx_hash').as('c')])
				.where((eb) =>
					eb.or([
						eb('from', '=', data.account as string),
						eb('to', '=', data.account as string),
					]),
				)
				.executeTakeFirst()
			const total = Number(
				(countResult as Record<string, unknown>)?.c ?? 0,
			)

			if (total === 0) return EMPTY_ACCOUNT_TRANSFERS_RESPONSE

			// Data
			const rows = (await QB(7)
				.withSignatures([TRANSFER_SIGNATURE])
				.selectFrom('transfer')
				.select([
					'address',
					'from',
					'to',
					'tokens',
					'tx_hash',
					'block_num',
					'block_timestamp',
				])
				.where((eb) =>
					eb.or([
						eb('from', '=', data.account as string),
						eb('to', '=', data.account as string),
					]),
				)
				.orderBy('block_num', 'desc')
				.limit(data.limit)
				.offset(offset)
				.execute()) as Array<{
				address: string
				from: string
				to: string
				tokens: string | bigint
				tx_hash: string
				block_num: string | number | bigint
				block_timestamp: string | null
			}>

			return {
				transfers: rows.map((row) => ({
					from: row.from as Address.Address,
					to: row.to as Address.Address,
					value: BigInt(row.tokens).toString(),
					transactionHash: row.tx_hash as Hex.Hex,
					blockNumber: String(row.block_num),
					timestamp: row.block_timestamp,
					token: {
						address: row.address as Address.Address,
						symbol: '',
						decimals: 18,
						currency: '',
					},
				})),
				total,
				totalCapped: total >= COUNT_CAP,
			}
		} catch (error) {
			console.error('[account-transfers] failed:', error)
			return EMPTY_ACCOUNT_TRANSFERS_RESPONSE
		}
	})

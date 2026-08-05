import * as Address from 'ox/Address'
import * as Hex from 'ox/Hex'
import * as z from 'zod/mini'
import type { Log } from 'viem'
import { readContract } from 'wagmi/actions'

import { parseKnownEvents } from '#lib/domain/known-events'
import { isTip20Address, type GetTip20MetadataFn, type Metadata } from '#lib/domain/tip20'
import { tempoQueryBuilder, tidx } from '#lib/server/tempo-queries-provider'
import { parseTimestamp } from '#lib/timestamp'
import { getWagmiConfig } from '#wagmi.config.ts'
import type { Config } from 'wagmi'

const QB = tempoQueryBuilder

export const [MAX_LIMIT, DEFAULT_LIMIT] = [100, 10]
const HISTORY_COUNT_MAX = 10_000
const CSV_EXPORT_LIMIT = HISTORY_COUNT_MAX

export type EnrichedTransaction = {
	hash: `0x${string}`
	blockNumber: string
	timestamp: number
	from: `0x${string}`
	to: `0x${string}` | null
	value: string
	status: 'success' | 'reverted'
	gasUsed: string
	effectiveGasPrice: string
	knownEvents: unknown[]
	feeInfo?: { amount: string; decimals: number; symbol: string }
}

export type HistoryResponse = {
	transactions: EnrichedTransaction[]
	total: number
	page: number
	limit: number
	hasMore: boolean
	countCapped: boolean
	error: null | string
}

export const RequestParametersSchema = z.object({
	page: z.prefault(z.coerce.number(), 1),
	limit: z.prefault(z.coerce.number(), DEFAULT_LIMIT),
	sort: z.prefault(z.enum(['asc', 'desc']), 'desc'),
	include: z.prefault(z.enum(['all', 'sent', 'received']), 'all'),
	status: z.optional(z.enum(['success', 'reverted'])),
	after: z.optional(z.coerce.number()),
})

export type HistoryRequestParameters = z.infer<typeof RequestParametersSchema>

function toHexQuantity(value: unknown): Hex.Hex {
	if (typeof value === 'bigint' || typeof value === 'number') {
		try {
			return Hex.fromNumber(value)
		} catch {
			return '0x0'
		}
	}
	if (typeof value === 'string') {
		try {
			return Hex.fromNumber(BigInt(value))
		} catch {
			return '0x0'
		}
	}
	return '0x0'
}

type TxRow = {
	hash: string
	from: string
	to: string | null
	value: string | bigint
	block_num: string | number | bigint
	block_timestamp: string | number | bigint | null
	status: number | null
	gas_used: string | number | bigint
	effective_gas_price: string | number | bigint
}

function rowToEnrichedTransaction(row: TxRow): EnrichedTransaction {
	return {
		hash: row.hash as `0x${string}`,
		blockNumber: toHexQuantity(row.block_num),
		timestamp: parseTimestamp(row.block_timestamp) ?? 0,
		from: Address.checksum(row.from as Address.Address),
		to: row.to ? Address.checksum(row.to as Address.Address) : null,
		value: toHexQuantity(row.value),
		status: row.status === 0 ? 'reverted' : 'success',
		gasUsed: toHexQuantity(row.gas_used),
		effectiveGasPrice: toHexQuantity(row.effective_gas_price),
		knownEvents: [],
	}
}

type TidxLogRow = {
	tx_hash: string
	address: string
	topic0: string | null
	topic1: string | null
	topic2: string | null
	topic3: string | null
	data: string | null
	block_num: string | number | bigint
	log_idx: number
}

function tidxLogToViemLog(row: TidxLogRow): Log {
	return {
		address: Address.checksum(row.address as Address.Address),
		topics: [
			row.topic0 as Hex.Hex,
			row.topic1 as Hex.Hex,
			row.topic2 as Hex.Hex,
			row.topic3 as Hex.Hex,
		].filter((t): t is Hex.Hex => t != null && t !== '0x'),
		data: (row.data ?? '0x') as Hex.Hex,
		blockNumber: BigInt(Number(row.block_num)),
		logIndex: Number(row.log_idx),
		transactionHash: row.tx_hash as Hex.Hex,
		transactionIndex: 0,
		blockHash: '0x0000000000000000000000000000000000000000000000000000000000000000',
		removed: false,
	}
}

const erc20MetadataAbi = [
	{ type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
	{ type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
	{ type: 'function', name: 'name', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
] as const

/**
 * Fetches logs for a set of transaction hashes, parses known events with token metadata.
 */
async function fetchKnownEventsForTransactions(
	txHashes: string[],
	chainId: number,
	txSenders?: Map<string, string>,
): Promise<Map<string, unknown[]>> {
	if (txHashes.length === 0) return new Map()

	const hashList = txHashes.map((h) => `'${h}'`).join(', ')
	const logsQuery = `SELECT tx_hash, address, topic0, topic1, topic2, topic3, data, block_num, log_idx FROM logs WHERE tx_hash IN (${hashList}) ORDER BY tx_hash, log_idx`

	try {
		const logsResult = await tidx.fetch({ chainId, query: logsQuery })
		const logRows = logsResult.rows as unknown as TidxLogRow[]

		// Group logs by tx_hash
		const logsByTx = new Map<string, Log[]>()
		const allTokenAddresses = new Set<string>()
		for (const row of logRows) {
			const existing = logsByTx.get(row.tx_hash) ?? []
			const log = tidxLogToViemLog(row)
			existing.push(log)
			logsByTx.set(row.tx_hash, existing)
			// Collect TIP20 token addresses for metadata lookup
			if (isTip20Address(row.address)) {
				allTokenAddresses.add(row.address.toLowerCase())
			}
		}

		// Fetch token metadata for all tokens found in logs
		const tokenMetadataMap = new Map<string, Metadata>()
		if (allTokenAddresses.size > 0) {
			const config = getWagmiConfig()
			await Promise.all(
				[...allTokenAddresses].map(async (tokenAddr) => {
					try {
						const [symbol, decimals, name] = await Promise.all([
							readContract(config as Config, {
								address: tokenAddr as Address.Address,
								abi: erc20MetadataAbi,
								functionName: 'symbol',
							}).catch(() => ''),
							readContract(config as Config, {
								address: tokenAddr as Address.Address,
								abi: erc20MetadataAbi,
								functionName: 'decimals',
							}).catch(() => 18),
							readContract(config as Config, {
								address: tokenAddr as Address.Address,
								abi: erc20MetadataAbi,
								functionName: 'name',
							}).catch(() => ''),
						])
						tokenMetadataMap.set(tokenAddr, {
							symbol: (symbol as string) || '',
							decimals: Number(decimals),
							name: (name as string) || '',
							currency: '',
							totalSupply: '0',
						} as Metadata)
					} catch {
						// Skip token if metadata fetch fails
					}
				}),
			)
		}

		const getTokenMetadata: GetTip20MetadataFn = (addr) =>
			tokenMetadataMap.get(addr.toLowerCase())

		// Parse known events for each transaction with token metadata
		// Also extract fee amounts from Transfer events to feeManager
		const FEE_MANAGER = '0xfeec000000000000000000000000000000000000'
		const TRANSFER_TOPIC = '0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef'
		const eventsByTx = new Map<string, unknown[]>()
		const feesByTx = new Map<string, { amount: string; decimals: number; symbol: string }>()

		for (const [txHash, logs] of logsByTx) {
			try {
				const sender = txSenders?.get(txHash) ?? '0x0000000000000000000000000000000000000000'
				const events = parseKnownEvents(
					{
						from: sender,
						to: null,
						status: 'success',
						logs,
						contractAddress: null,
					} as any,
					{ getTokenMetadata },
				)
				eventsByTx.set(txHash, events)

				// Extract fee from Transfer events to feeManager
				for (const log of logs) {
					if (log.topics[0]?.toLowerCase() !== TRANSFER_TOPIC) continue
					if (log.topics.length < 3) continue
					const toRaw = log.topics[2]
					const toAddr = '0x' + toRaw.slice(-40).toLowerCase()
					if (toAddr !== FEE_MANAGER) continue

					// This is a fee payment - extract amount and token info
					const tokenAddr = log.address.toLowerCase()
					const metadata = getTokenMetadata(tokenAddr as any)
					const amount = log.data && log.data !== '0x'
						? BigInt(log.data).toString()
						: '0'

					feesByTx.set(txHash, {
						amount,
						decimals: metadata?.decimals ?? 18,
						symbol: metadata?.symbol ?? '',
					})
					break
				}
			} catch {
				eventsByTx.set(txHash, [])
			}
		}

		// Store feesByTx for use by the caller
		;(fetchKnownEventsForTransactions as any)._lastFees = feesByTx

		return eventsByTx
	} catch (error) {
		console.error('[address-history] failed to fetch logs:', error)
		return new Map()
	}
}

/**
 * Fetches address transaction history from tidx using SQL queries.
 * Replaces the Tempo API-based implementation.
 */
export async function fetchAddressHistoryData(params: {
	address: Address.Address
	chainId: number
	searchParams: HistoryRequestParameters
	maxLimit?: number | undefined
	includeKnownEvents?: boolean | undefined
}): Promise<HistoryResponse> {
	const { address, chainId, searchParams } = params
	const maxLimit = params.maxLimit ?? MAX_LIMIT

	const page = Math.max(
		1,
		Number.isFinite(searchParams.page) ? Math.floor(searchParams.page) : 1,
	)
	let limit = Number.isFinite(searchParams.limit)
		? Math.floor(searchParams.limit)
		: DEFAULT_LIMIT
	if (limit > maxLimit) throw new Error('Limit is too high')
	if (limit < 1) limit = 1

	const emptyResponse: HistoryResponse = {
		transactions: [],
		total: 0,
		page,
		limit,
		hasMore: false,
		countCapped: false,
		error: null,
	}

	if (page * limit > HISTORY_COUNT_MAX) return emptyResponse

	const offset = (page - 1) * limit
	const direction = searchParams.sort === 'asc' ? 'ASC' : 'DESC'
	const addr = address.toLowerCase()

	// Build WHERE clause based on include filter
	const sideFilter =
		searchParams.include === 'sent'
			? `t."from" = '${addr}'`
			: searchParams.include === 'received'
				? `t."to" = '${addr}'`
				: `(t."from" = '${addr}' OR t."to" = '${addr}')`

	const statusFilter = searchParams.status
		? ` AND r.status = ${searchParams.status === 'reverted' ? 0 : 1}`
		: ''

	const afterFilter = searchParams.after
		? ` AND t.block_timestamp >= '${new Date(searchParams.after * 1000).toISOString()}'`
		: ''

	try {
		// Count query
		const countQuery = `SELECT COUNT(DISTINCT t.hash) as total FROM txs t LEFT JOIN receipts r ON r.tx_hash = t.hash WHERE ${sideFilter}${statusFilter}${afterFilter}`
		const countResult = await tidx.fetch({ chainId, query: countQuery })
		// tidx returns rows as objects: [{ total: 130n }], not arrays
		const countRow = countResult.rows[0] as Record<string, unknown> | undefined
		const total = Number(countRow?.total ?? 0)

		if (total === 0) return emptyResponse

		// Data query
		const dataQuery = `SELECT DISTINCT t.hash, t."from", t."to", t.value, t.block_num, t.block_timestamp, r.status, r.gas_used, r.effective_gas_price FROM txs t LEFT JOIN receipts r ON r.tx_hash = t.hash WHERE ${sideFilter}${statusFilter}${afterFilter} ORDER BY t.block_num ${direction} LIMIT ${limit} OFFSET ${offset}`
		const dataResult = await tidx.fetch({ chainId, query: dataQuery })

		const transactions = (dataResult.rows as unknown as TxRow[]).map(
			rowToEnrichedTransaction,
		)

		// Fetch logs and parse known events for the description column
		const includeKnownEvents = params.includeKnownEvents ?? true
		if (includeKnownEvents && transactions.length > 0) {
			const txHashes = transactions.map((tx) => tx.hash)
			const txSenders = new Map<string, string>()
			for (const tx of transactions) {
				txSenders.set(tx.hash, tx.from)
			}
			const eventsByTx = await fetchKnownEventsForTransactions(txHashes, chainId, txSenders)
			const feesByTx = (fetchKnownEventsForTransactions as any)._lastFees as Map<string, { amount: string; decimals: number; symbol: string }> | undefined
			for (const tx of transactions) {
				const events = eventsByTx.get(tx.hash) ?? []
				// Serialize BigInt values to strings for JSON compatibility
				tx.knownEvents = JSON.parse(
					JSON.stringify(events, (_key, value) =>
						typeof value === 'bigint' ? value.toString() : value,
					),
				)
				// Add fee info from Transfer events to feeManager
				const feeInfo = feesByTx?.get(tx.hash)
				if (feeInfo) {
					;(tx as any).feeInfo = feeInfo
				}
			}
		}

		return {
			transactions,
			total,
			page,
			limit,
			hasMore: offset + limit < total,
			countCapped: false,
			error: null,
		}
	} catch (error) {
		console.error('[address-history] tidx query failed:', error)
		return {
			...emptyResponse,
			error: error instanceof Error ? error.message : 'Query failed',
		}
	}
}

/**
 * Bulk rows for the CSV export using tidx SQL directly.
 */
export async function fetchAddressHistoryExportRows(params: {
	address: Address.Address
	chainId: number
	searchParams: HistoryRequestParameters
}): Promise<ReadonlyArray<EnrichedTransaction>> {
	const { searchParams } = params
	const addr = params.address.toLowerCase()
	const direction = searchParams.sort === 'asc' ? 'ASC' : 'DESC'

	const sideFilter =
		searchParams.include === 'sent'
			? `t."from" = '${addr}'`
			: searchParams.include === 'received'
				? `t."to" = '${addr}'`
				: `(t."from" = '${addr}' OR t."to" = '${addr}')`

	const statusFilter = searchParams.status
		? ` AND r.status = ${searchParams.status === 'reverted' ? 0 : 1}`
		: ''

	const afterFilter = searchParams.after
		? ` AND t.block_timestamp >= '${new Date(searchParams.after * 1000).toISOString()}'`
		: ''

	const query = `SELECT DISTINCT t.hash, t."from", t."to", t.value, t.block_num, t.block_timestamp, r.status, r.gas_used, r.effective_gas_price FROM txs t LEFT JOIN receipts r ON r.tx_hash = t.hash WHERE ${sideFilter}${statusFilter}${afterFilter} ORDER BY t.block_num ${direction} LIMIT ${CSV_EXPORT_LIMIT}`

	const result = await tidx.fetch({ chainId: params.chainId, query })
	return (result.rows as unknown as TxRow[]).map(rowToEnrichedTransaction)
}

function hexToDecimalString(value: string | null | undefined): string {
	if (!value) return ''
	try {
		return BigInt(value).toString()
	} catch {
		return ''
	}
}

import {
	buildCsv,
	createCsvDownloadResponse,
	createTimestampedCsvFilename,
} from '#lib/server/csv'

export function createTransactionsCsvResponse(params: {
	address: Address.Address
	transactions: ReadonlyArray<EnrichedTransaction>
}): Response {
	const rows: Array<ReadonlyArray<unknown>> = [
		[
			'timestamp_iso',
			'timestamp_unix',
			'status',
			'direction',
			'hash',
			'block_number',
			'from',
			'to',
			'value_wei',
			'gas_used',
			'effective_gas_price_wei',
			'fee_wei',
		],
	]

	for (const transaction of params.transactions) {
		const gasUsed = hexToDecimalString(transaction.gasUsed)
		const effectiveGasPrice = hexToDecimalString(transaction.effectiveGasPrice)
		const feeWei =
			gasUsed && effectiveGasPrice
				? (BigInt(gasUsed) * BigInt(effectiveGasPrice)).toString()
				: ''

		const direction = Address.isEqual(transaction.from, params.address)
			? transaction.to && Address.isEqual(transaction.to, params.address)
				? 'self'
				: 'sent'
			: transaction.to && Address.isEqual(transaction.to, params.address)
				? 'received'
				: 'related'

		rows.push([
			transaction.timestamp > 0
				? new Date(transaction.timestamp * 1000).toISOString()
				: '',
			transaction.timestamp,
			transaction.status,
			direction,
			transaction.hash,
			hexToDecimalString(transaction.blockNumber),
			transaction.from,
			transaction.to,
			hexToDecimalString(transaction.value),
			gasUsed,
			effectiveGasPrice,
			feeWei,
		])
	}

	return createCsvDownloadResponse({
		csv: buildCsv(rows),
		filename: createTimestampedCsvFilename('transactions', params.address),
		headers: {
			'X-Tempo-Export-Row-Limit': String(CSV_EXPORT_LIMIT),
		},
	})
}

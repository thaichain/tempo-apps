import { createServerFn } from '@tanstack/react-start'
import type { Address } from 'ox'
import { VirtualAddress } from 'ox/tempo'
import { getCode } from 'viem/actions'
import { type AccountType, getAccountType } from '#lib/account'
import { isTip20Address } from '#lib/domain/tip20'
import {
	fetchAddressOldestTx,
	fetchAddressTxStats,
	fetchTokenTransferBoundaries,
	fetchVirtualAddressTransferStats,
} from '#lib/server/tempo-queries'
import { parseTimestamp } from '#lib/timestamp'
import { zAddress } from '#lib/zod'
import { getBatchedClient, getTempoChain } from '#wagmi.config.ts'

/**
 * Stub: Token header stats not available without Tempo API.
 */
export async function fetchTokenHeaderStats(
	_chainId: number,
	_token: Address.Address,
): Promise<undefined> {
	return undefined
}

type AddressTxAggregate = {
	count?: number
	latestTxsBlockTimestamp?: unknown
	oldestTxsBlockTimestamp?: unknown
	oldestTxHash?: string
	oldestTxFrom?: string
}

export function pickTip20CreatedTimestamp(params: {
	tokenCreatedTimestamp: unknown
	firstTransferTimestamp: unknown
}): number | undefined {
	const tokenCreatedTimestamp = parseTimestamp(params.tokenCreatedTimestamp)
	const firstTransferTimestamp = parseTimestamp(params.firstTransferTimestamp)

	if (tokenCreatedTimestamp != null) return tokenCreatedTimestamp
	return firstTransferTimestamp
}

export function buildAddressTxMetadata(aggregate: AddressTxAggregate): {
	txCount: number
	lastActivityTimestamp?: number
	createdTimestamp?: number
	createdTxHash?: string
	createdBy?: string
} {
	const oldestTimestamp = parseTimestamp(aggregate.oldestTxsBlockTimestamp)

	return {
		txCount: aggregate.count ?? 0,
		lastActivityTimestamp: parseTimestamp(aggregate.latestTxsBlockTimestamp),
		createdTimestamp: oldestTimestamp,
		createdTxHash: aggregate.oldestTxHash,
		createdBy: aggregate.oldestTxFrom,
	}
}

/**
 * Fetches address tx metadata from tidx SQL queries.
 * Replaces the Tempo API-based implementation.
 */
export async function fetchAddressTxMetadata(
	chainId: number,
	address: Address.Address,
): Promise<AddressTxAggregate> {
	const [txStats, oldestTx] = await Promise.all([
		fetchAddressTxStats(address, chainId).catch(() => ({
			count: 0,
			oldestTimestamp: undefined,
			latestTimestamp: undefined,
		})),
		fetchAddressOldestTx(address, chainId).catch(() => undefined),
	])

	return {
		count: txStats.count,
		latestTxsBlockTimestamp: txStats.latestTimestamp,
		oldestTxsBlockTimestamp: txStats.oldestTimestamp,
		oldestTxHash: oldestTx?.hash,
		oldestTxFrom: oldestTx?.from,
	}
}

export type AddressMetadata = {
	address: string
	chainId: number
	accountType: AccountType
	txCount?: number
	holdersCount?: number
	lastActivityTimestamp?: number
	createdTimestamp?: number
	createdTxHash?: string
	createdBy?: string
}

const METADATA_CACHE_TTL = 30_000
const METADATA_CACHE_MAX_ENTRIES = 50
const metadataCache = new Map<
	string,
	{ promise: Promise<AddressMetadata>; timestamp: number }
>()

export function getAddressMetadata(
	address: Address.Address,
): Promise<AddressMetadata> {
	const { id: chainId } = getTempoChain()
	const cacheKey = `${chainId}-${address}`
	const cached = metadataCache.get(cacheKey)
	if (cached && Date.now() - cached.timestamp < METADATA_CACHE_TTL)
		return cached.promise

	if (
		!metadataCache.has(cacheKey) &&
		metadataCache.size >= METADATA_CACHE_MAX_ENTRIES
	) {
		const oldestKey = metadataCache.keys().next().value
		if (oldestKey) metadataCache.delete(oldestKey)
	}
	const promise = loadAddressMetadata(address, chainId)
	metadataCache.set(cacheKey, { promise, timestamp: Date.now() })
	promise.catch(() => {
		if (metadataCache.get(cacheKey)?.promise === promise)
			metadataCache.delete(cacheKey)
	})
	return promise
}

async function loadAddressMetadata(
	address: Address.Address,
	chainId: number,
): Promise<AddressMetadata> {
	const client = getBatchedClient()
	const isTip20 = isTip20Address(address)
	const isVirtual = VirtualAddress.validate(address)

	const bytecodePromise = getCode(client, { address }).catch(() => undefined)

	let response: AddressMetadata

	if (isVirtual) {
		const [bytecode, stats] = await Promise.all([
			bytecodePromise,
			fetchVirtualAddressTransferStats(address, chainId).catch(() => ({
				count: 0,
				oldestTimestamp: undefined,
				latestTimestamp: undefined,
			})),
		])
		response = {
			address,
			chainId,
			accountType: getAccountType(bytecode),
			txCount: stats.count,
			lastActivityTimestamp: parseTimestamp(stats.latestTimestamp),
			createdTimestamp: parseTimestamp(stats.oldestTimestamp),
		}
	} else if (isTip20) {
		const [bytecode, stats, boundaries] = await Promise.all([
			bytecodePromise,
			fetchTokenHeaderStats(chainId, address),
			fetchTokenTransferBoundaries(address, chainId).catch(() => ({
				oldestTimestamp: undefined,
				latestTimestamp: undefined,
			})),
		])
		response = {
			address,
			chainId,
			accountType: getAccountType(bytecode),
			holdersCount: undefined,
			lastActivityTimestamp: parseTimestamp(boundaries.latestTimestamp),
			createdTimestamp: pickTip20CreatedTimestamp({
				tokenCreatedTimestamp: undefined,
				firstTransferTimestamp: boundaries.oldestTimestamp,
			}),
		}
	} else {
		const [bytecode, stats] = await Promise.all([
			bytecodePromise,
			fetchAddressTxMetadata(chainId, address),
		])
		const accountType = getAccountType(bytecode)
		const metadata = buildAddressTxMetadata(stats)

		response = {
			address,
			chainId,
			accountType,
			...metadata,
		}
	}

	return response
}

export const fetchAddressMetadata = createServerFn({ method: 'GET' })
	.inputValidator((input) => zAddress({ lowercase: true }).parse(input))
	.handler(({ data }) => getAddressMetadata(data))

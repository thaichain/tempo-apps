import { createServerFn } from '@tanstack/react-start'
import type { Address } from 'ox'
import * as z from 'zod/mini'

export type Token = {
	address: Address.Address
	symbol: string
	name: string
	currency: string
	logoURI?: string | undefined
	createdAt?: number | undefined
	holdersCount?: number
}

const FetchTokensInputSchema = z.object({
	page: z.coerce.number().check(z.gte(1)),
	limit: z.coerce.number().check(z.gte(1), z.lte(25)),
})

export type TokensApiResponse = {
	tokens: Token[]
	total: number
}

const TOKENLIST_BASE_URL = 'https://tokenlist.thaichain.org'

type TokenListResponse = {
	tokens: Array<{
		name: string
		symbol: string
		decimals: number
		chainId: number
		address: string
		logoURI?: string
	}>
}

/**
 * Fetches the verified token list from the ThaiChain tokenlist service.
 * Replaces the Tempo API-based implementation.
 */
export const fetchTokens = createServerFn({ method: 'POST' })
	.inputValidator((input) => FetchTokensInputSchema.parse(input))
	.handler(async ({ data }): Promise<TokensApiResponse> => {
		const { page, limit } = data
		const offset = (page - 1) * limit

		try {
			const response = await fetch(`${TOKENLIST_BASE_URL}/list/7`)
			if (!response.ok) return { tokens: [], total: 0 }

			const tokenList = (await response.json()) as TokenListResponse
			const allTokens = tokenList.tokens ?? []

			const pageTokens = allTokens.slice(offset, offset + limit)

			return {
				total: allTokens.length,
				tokens: pageTokens.map(
					(token): Token => ({
						address: token.address as Address.Address,
						symbol: token.symbol,
						name: token.name,
						currency: token.symbol === 'TCH' ? 'THAI' : '',
						// logoURI omitted - use tokenlist icon URL instead
					}),
				),
			}
		} catch (error) {
			console.error('[tokens] failed to fetch tokenlist:', error)
			return { tokens: [], total: 0 }
		}
	})

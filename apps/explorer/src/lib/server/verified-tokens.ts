const TOKENLIST_BASE_URL = 'https://tokenlist.thaichain.org'

export type VerifiedToken = {
	address: string
	symbol: string
	name: string
	currency: string
	decimals: number
	logoUri?: string
}

type TokenListResponse = {
	tokens: Array<{
		name: string
		symbol: string
		decimals: number
		address: string
		logoURI?: string
	}>
}

type CachedVerifiedTokens = { tokens: VerifiedToken[]; ts: number }
const verifiedTokensCache = new Map<number, CachedVerifiedTokens>()

/**
 * Returns verified tokens from the ThaiChain tokenlist service.
 */
export async function getVerifiedTokens(
	chainId: number,
): Promise<VerifiedToken[]> {
	const now = Date.now()
	const cached = verifiedTokensCache.get(chainId)
	if (cached && now - cached.ts < 5 * 60_000) return cached.tokens

	try {
		const response = await fetch(`${TOKENLIST_BASE_URL}/list/${chainId}`)
		if (!response.ok) return cached?.tokens ?? []

		const tokenList = (await response.json()) as TokenListResponse
		const tokens: VerifiedToken[] = (tokenList.tokens ?? []).map((token) => ({
			address: token.address,
			symbol: token.symbol,
			name: token.name,
			decimals: token.decimals,
			currency: token.symbol === 'TCH' ? 'THAI' : '',
			logoUri: token.logoURI,
		}))

		verifiedTokensCache.set(chainId, { tokens, ts: now })
		return tokens
	} catch (error) {
		console.error('Failed to fetch verified tokens:', error)
		return cached?.tokens ?? []
	}
}

export async function getVerifiedTokenAddresses(
	chainId: number,
): Promise<Set<string>> {
	const tokens = await getVerifiedTokens(chainId)
	return new Set(tokens.map((token) => token.address.toLowerCase()))
}

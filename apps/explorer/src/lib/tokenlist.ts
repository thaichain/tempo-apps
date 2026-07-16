export const TOKENLIST_BASE_URL = 'https://tokenlist.thaichain.org'

export const TOKENLIST_URLS: Record<number, string> = {
	7: `${TOKENLIST_BASE_URL}/list/7`,
}

const FEE_TOKEN_BY_CHAIN_ID: Record<number, `0x${string}`> = {
	7: '0x20c0000000000000000000000000000000000000',
}

export function getFeeTokenForChain(
	chainId: number,
): `0x${string}` | undefined {
	return FEE_TOKEN_BY_CHAIN_ID[chainId]
}

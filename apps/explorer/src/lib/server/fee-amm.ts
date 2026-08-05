import { createServerFn } from '@tanstack/react-start'
import type { Address } from 'ox'

export type FeeAmmPool = {
	poolId: `0x${string}`
	userToken: Address.Address
	validatorToken: Address.Address
	createdAt: number | null
	latestMintAt: number | null
	mintCount: number
	reserveUserToken: bigint
	reserveValidatorToken: bigint
	liquidityUsd: number
	userTokenSymbol: string
	userTokenName: string
	userTokenDecimals: number
	validatorTokenSymbol: string
	validatorTokenName: string
	validatorTokenDecimals: number
}

/**
 * Stub: Fee AMM pools are not available without the Tempo API.
 * Returns empty array for ThaiChain.
 */
export const fetchFeeAmmPools = createServerFn({ method: 'POST' }).handler(
	async (): Promise<FeeAmmPool[]> => {
		return []
	},
)

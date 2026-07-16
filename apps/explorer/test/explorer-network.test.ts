import { describe, expect, it } from 'vitest'
import {
	buildExplorerNetworkHref,
	EXPLORER_NETWORK_OPTIONS,
	isExplorerNetworkPathPreservable,
} from '#lib/explorer-network.ts'

const THAICHAIN_HOST = 'https://exp.thaichain.org'

const SAMPLE_HASH =
	'0x0000000000000000000000000000000000000000000000000000000000000000'
const SAMPLE_ADDRESS = '0x20c0000000000000000000000000000000000000'

describe('explorer network switcher hrefs', () => {
	it('uses the Thaichain explorer host', () => {
		expect(EXPLORER_NETWORK_OPTIONS).toEqual([
			expect.objectContaining({
				env: 'thaichain',
				host: THAICHAIN_HOST,
			}),
		])
	})

	it.each([
		['transaction', `/tx/${SAMPLE_HASH}`],
		['receipt', `/receipt/${SAMPLE_HASH}`],
		['block', '/block/123456?page=2'],
		['address', `/address/${SAMPLE_ADDRESS}?tab=tokens&page=3`],
		['token compatibility route', `/token/${SAMPLE_ADDRESS}?tab=holders`],
		['fee amm route with hash', '/fee-amm#pools'],
	])('preserves the %s resource path when switching networks', (_, path) => {
		expect(buildExplorerNetworkHref(THAICHAIN_HOST, path)).toBe(
			`${THAICHAIN_HOST}${path}`,
		)
	})

	it('normalizes a path without a leading slash', () => {
		expect(buildExplorerNetworkHref(THAICHAIN_HOST, 'blocks')).toBe(
			`${THAICHAIN_HOST}/blocks`,
		)
	})

	it('preserves resource paths even when the current route rendered not found', () => {
		expect(isExplorerNetworkPathPreservable(`/receipt/${SAMPLE_HASH}`)).toBe(
			true,
		)
		expect(
			isExplorerNetworkPathPreservable(`/tx/${SAMPLE_HASH}?tab=logs#top`),
		).toBe(true)
		expect(
			buildExplorerNetworkHref(THAICHAIN_HOST, `/receipt/${SAMPLE_HASH}`),
		).toBe(`${THAICHAIN_HOST}/receipt/${SAMPLE_HASH}`)
		expect(
			buildExplorerNetworkHref(
				THAICHAIN_HOST,
				`/tx/${SAMPLE_HASH}?tab=logs#top`,
			),
		).toBe(`${THAICHAIN_HOST}/tx/${SAMPLE_HASH}?tab=logs#top`)
	})

	it('still links unknown not-found routes to the target network homepage', () => {
		expect(isExplorerNetworkPathPreservable('/definitely-not-a-route')).toBe(
			false,
		)
		expect(
			buildExplorerNetworkHref(THAICHAIN_HOST, '/definitely-not-a-route', {
				fallbackToHome: true,
			}),
		).toBe(`${THAICHAIN_HOST}/`)
	})
})

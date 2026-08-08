import { describe, expect, it } from 'vitest'
import app from '../src/index.tsx'

type Asset = {
	body: string
	contentType?: string | undefined
}

function createAssets(files: Record<string, Asset>): Fetcher {
	return {
		fetch: async (input) => {
			const url = new URL(input.toString())
			const asset = files[url.pathname]
			if (!asset) return new Response('not found', { status: 404 })

			const headers = new Headers()
			if (asset.contentType) headers.set('Content-Type', asset.contentType)

			return new Response(asset.body, { headers })
		},
	} satisfies Fetcher
}

describe('token icon route', () => {
	it('serves the token SVG icon', async () => {
		const response = await app.request(
			'/icon/7/0x20c0000000000000000000000000000000000000',
			{},
			{
				ASSETS: createAssets({
					'/7/icons/0x20c0000000000000000000000000000000000000.svg': {
						body: 'token icon',
						contentType: 'image/svg+xml',
					},
					'/7/icons/fallback.svg': {
						body: 'fallback icon',
						contentType: 'image/svg+xml',
					},
				}),
			},
		)

		await expect(response.text()).resolves.toBe('token icon')
		expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
	})

	it('lowercases the address and strips a .svg suffix', async () => {
		const response = await app.request(
			'/icon/7/0x20C0000000000000000000000000000000000000.svg',
			{},
			{
				ASSETS: createAssets({
					'/7/icons/0x20c0000000000000000000000000000000000000.svg': {
						body: 'token icon',
						contentType: 'image/svg+xml',
					},
				}),
			},
		)

		await expect(response.text()).resolves.toBe('token icon')
	})

	it('falls back to the default SVG when no token icon exists', async () => {
		const response = await app.request(
			'/icon/7/0x20c000000000000000000000000000000000dead',
			{},
			{
				ASSETS: createAssets({
					'/7/icons/fallback.svg': {
						body: 'fallback icon',
						contentType: 'image/svg+xml',
					},
				}),
			},
		)

		await expect(response.text()).resolves.toBe('fallback icon')
		expect(response.headers.get('Content-Type')).toBe('image/svg+xml')
	})

	it('returns 404 for an unsupported chain', async () => {
		const response = await app.request(
			'/icon/9999/0x20c0000000000000000000000000000000000000',
			{},
			{ ASSETS: createAssets({}) },
		)

		expect(response.status).toBe(404)
	})
})

describe('token list route', () => {
	it('serves the static tokenlist.json for a chain', async () => {
		const list = { name: 'ThaiChain', tokens: [] }
		const response = await app.request(
			'/list/7',
			{},
			{
				ASSETS: createAssets({
					'/7/tokenlist.json': {
						body: JSON.stringify(list),
						contentType: 'application/json',
					},
				}),
			},
		)

		expect(response.status).toBe(200)
		await expect(response.json()).resolves.toEqual(list)
	})

	it('returns 404 when the chain has no tokenlist.json', async () => {
		const response = await app.request(
			'/list/7',
			{},
			{ ASSETS: createAssets({}) },
		)

		expect(response.status).toBe(404)
	})
})

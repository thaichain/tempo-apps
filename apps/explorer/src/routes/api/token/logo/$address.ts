import { createFileRoute } from '@tanstack/react-router'
import * as Address from 'ox/Address'

const TOKENLIST_BASE_URL = 'https://tokenlist.thaichain.org'

/**
 * Fetches token logo from the ThaiChain tokenlist service.
 */
export const Route = createFileRoute('/api/token/logo/$address')({
	server: {
		handlers: {
			GET: async ({ params }) => {
				if (!Address.validate(params.address))
					return new Response(null, { status: 400 })
				const address = params.address.toLowerCase()

				try {
					// Fetch tokenlist and find the logo URI
					const response = await fetch(`${TOKENLIST_BASE_URL}/list/7`)
					if (!response.ok) return new Response(null, { status: 404 })

					const tokenList = await response.json()
					const token = (tokenList.tokens ?? []).find(
						(t: { address: string }) => t.address.toLowerCase() === address
					)

					if (!token?.logoURI) return new Response(null, { status: 404 })

					// Fetch and proxy the logo image
					const logoResponse = await fetch(token.logoURI)
					if (!logoResponse.ok) return new Response(null, { status: 404 })

					return new Response(logoResponse.body, {
						status: 200,
						headers: {
							'Content-Type': logoResponse.headers.get('Content-Type') ?? 'image/svg+xml',
							'Cache-Control': 'public, max-age=86400, stale-while-revalidate=604800',
						},
					})
				} catch {
					return new Response(null, { status: 404 })
				}
			},
		},
	},
})

import { QB, Tidx } from 'tidx.ts'
import { serverEnv } from './env'

// Hardcoded for Thaichain: Cloudflare Workers `vars` are injected into the
// request `env` parameter, not `process.env` at module load time.
const tidx = Tidx.create({
	basicAuth: serverEnv.TIDX_BASIC_AUTH,
	baseUrl: 'https://tidx.thaichain.org',
})

tidx.on('response', (res) => {
	if (!res.ok)
		res
			.clone()
			.text()
			.then((body) =>
				console.error(
					`[tidx:${res.status}]`,
					decodeURIComponent(res.url),
					body,
					`(auth=${serverEnv.TIDX_BASIC_AUTH ? 'set' : 'missing'})`,
				),
			)
})

export function tempoQueryBuilder(chainId: number) {
	return QB.from({ ...tidx, chainId })
}

export function tempoFastLookupQueryBuilder(chainId: number) {
	return QB.from({ ...tidx, chainId, engine: 'clickhouse' })
}

export { tidx }

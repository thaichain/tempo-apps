import { QB, Tidx } from 'tidx.ts'

const tidx = Tidx.create({
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
				),
			)
})

export function tempoQueryBuilder(
	chainId: number,
	options: { engine?: string | undefined } = {},
) {
	return QB.from({ ...tidx, chainId, ...options })
}

export { tidx }

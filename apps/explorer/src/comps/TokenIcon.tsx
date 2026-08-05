import type { Address } from 'ox'
import * as React from 'react'
import { cx } from '#lib/css'
import { resolveLogoURI } from '#lib/domain/tip20'
import { getTempoChain } from '#wagmi.config'

const TOKENLIST_BASE_URL = 'https://tokenlist.thaichain.org'
const TOKEN_ICON_BASE_URL = `${TOKENLIST_BASE_URL}/icon/${getTempoChain().id}`
const TOKEN_ICON_FALLBACK_SRC = '/token-fallback.svg'

export function TokenIcon(props: TokenIcon.Props) {
	const { address, className } = props
	const fallbackSrc = `${TOKEN_ICON_BASE_URL}/${address}`
	// Always use tokenlist icon URL (like exp.thaichain.org), ignore logoURI
	const [src, setSrc] = React.useState(fallbackSrc)

	React.useEffect(() => {
		setSrc(fallbackSrc)
	}, [fallbackSrc])

	return (
		<img
			src={src}
			alt=""
			className={cx('size-4 rounded-full shrink-0', className)}
			onError={(e) => {
				if (e.currentTarget.src !== fallbackSrc) {
					setSrc(fallbackSrc)
					return
				}
				e.currentTarget.style.display = 'none'
			}}
		/>
	)
}

export namespace TokenIcon {
	export interface Props {
		address: Address.Address
		name?: string
		className?: string
		logoURI?: string | null | undefined
	}
}

import { Link } from '@tanstack/react-router'
import type { Address } from 'ox'
import type * as React from 'react'
import { Midcut } from '#comps/Midcut'

export function FeePayer(props: FeePayer.Props): React.JSX.Element {
	const { address } = props

	return (
		<Link
			to="/address/$address"
			params={{ address }}
			className="text-[13px] text-accent hover:underline press-down w-full font-mono max-w-[50ch]"
			title={address}
		>
			<Midcut value={address} prefix="0x" min={4} align="end" />
		</Link>
	)
}

export declare namespace FeePayer {
	type Props = {
		address: Address.Address
	}
}

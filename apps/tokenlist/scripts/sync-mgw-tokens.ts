import * as fs from 'node:fs'
import * as path from 'node:path'

const RPC_URL = 'https://rpc.paysonow.com'
const TOKENLIST_PATH = path.join('data', '3773', 'tokenlist.json')
const REC_OTHER_URL = 'https://assets.mgwtoken.com/rec-other.json'

// ERC-20 ABI
const ERC20_ABI = [
  {
    name: 'name',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'symbol',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'string' }],
  },
  {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint8' }],
  },
]

async function callRPC(
  address: string,
  functionName: string,
): Promise<string | number | null> {
  const functionSignatures: Record<string, string> = {
    name: '0x06fdde03',
    symbol: '0x95d89b41',
    decimals: '0x313ce567',
  }

  const data = functionSignatures[functionName]
  if (!data) return null

  try {
    const response = await fetch(RPC_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_call',
        params: [
          {
            to: address,
            data: data,
          },
          'latest',
        ],
        id: 1,
      }),
    })

    const result = (await response.json()) as {
      error?: unknown
      result?: string | null
    }

    if (result.error || !result.result) {
      return null
    }

    const hex = result.result

    if (functionName === 'decimals') {
      return parseInt(hex, 16)
    }

    // Decode string from hex
    // Remove 0x prefix
    const cleanHex = hex.replace('0x', '')

    // First 64 chars = offset (skip)
    // Next 64 chars = length
    const lengthHex = cleanHex.substring(64, 128)
    const length = parseInt(lengthHex, 16)

    // Rest = actual string data
    const dataHex = cleanHex.substring(128, 128 + length * 2)

    // Convert hex to string
    let str = ''
    for (let i = 0; i < dataHex.length; i += 2) {
      const charCode = parseInt(dataHex.substring(i, i + 2), 16)
      if (charCode !== 0) {
        str += String.fromCharCode(charCode)
      }
    }

    return str
  } catch (error) {
    console.error(`Error calling ${functionName} for ${address}:`, error)
    return null
  }
}

async function getTokenMetadata(address: string) {
  const [name, symbol, decimals] = await Promise.all([
    callRPC(address, 'name'),
    callRPC(address, 'symbol'),
    callRPC(address, 'decimals'),
  ])

  return {
    name: name as string | null,
    symbol: symbol as string | null,
    decimals: (decimals as number | null) ?? 18,
  }
}

async function main() {
  console.log('Fetching token list from mgwtoken.com...')
  const response = await fetch(REC_OTHER_URL)
  const data = (await response.json()) as { rectoken: string[] }
  const addresses: string[] = data.rectoken

  console.log(`Found ${addresses.length} tokens to process`)

  // Read existing tokenlist
  const tokenlist = JSON.parse(
    fs.readFileSync(TOKENLIST_PATH, 'utf-8'),
  ) as {
    tokens: Array<{
      name: string
      symbol: string
      decimals: number
      chainId: number
      address: string
      extensions?: Record<string, unknown>
    }>
    version: { major: number; minor: number; patch: number }
    timestamp: string
  }
  const existingAddresses = new Set(
    tokenlist.tokens.map((t) => t.address.toLowerCase()),
  )

  console.log(`Existing tokens in tokenlist: ${existingAddresses.size}`)

  // Filter out existing tokens
  const newAddresses = addresses.filter(
    (addr) => !existingAddresses.has(addr.toLowerCase()),
  )

  console.log(`New tokens to add: ${newAddresses.length}`)

  if (newAddresses.length === 0) {
    console.log('No new tokens to add!')
    return
  }

  // Fetch metadata for new tokens
  const newTokens = []
  for (let i = 0; i < newAddresses.length; i++) {
    const address = newAddresses[i]!
    console.log(
      `\n[${i + 1}/${newAddresses.length}] Processing ${address}...`,
    )

    const metadata = await getTokenMetadata(address)

    if (!metadata.name && !metadata.symbol) {
      console.log(`  ⚠️  Skipping (not a valid ERC-20)`)
      continue
    }

    console.log(
      `  ✅ ${metadata.name} (${metadata.symbol}) - ${metadata.decimals} decimals`,
    )

    newTokens.push({
      name: metadata.name || '',
      symbol: metadata.symbol || '',
      decimals: metadata.decimals,
      chainId: 3773,
      address: address,
      extensions: {
        chain: 'paysonow',
        label: metadata.symbol || '',
      },
    })

    // Add delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 200))
  }

  if (newTokens.length === 0) {
    console.log('\nNo valid tokens found!')
    return
  }

  // Add new tokens to tokenlist
  tokenlist.tokens.push(...newTokens)

  // Update version
  tokenlist.version.patch += 1
  tokenlist.timestamp = new Date().toISOString()

  // Write back
  fs.writeFileSync(TOKENLIST_PATH, JSON.stringify(tokenlist, null, 2) + '\n')

  console.log(
    `\n✅ Successfully added ${newTokens.length} tokens to tokenlist!`,
  )
  console.log(`📄 Updated: ${TOKENLIST_PATH}`)
}

main().catch(console.error)

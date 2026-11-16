const DERIVATIVE_SEGMENTS = new Set(['NFO', 'BFO', 'CDS', 'BCD', 'MCX', 'NCO', 'NCDEX'])
const CASH_SEGMENTS = new Set(['NSE', 'BSE', 'NSE_INDEX', 'BSE_INDEX', 'MCX_INDEX', 'GLOBAL_INDEX'])
const DERIVATIVE_TYPES = new Set(['FUT', 'CE', 'PE', 'PERPFUT'])

/** Capability comes from instrument metadata, never from the history column's value. */
export function openInterestCapability(
  exchange: string,
  metadata: Record<string, unknown> = {}
): boolean | undefined {
  if (typeof metadata.hasOpenInterest === 'boolean') return metadata.hasOpenInterest
  const instrumentType = String(metadata.instrumenttype ?? '')
    .trim()
    .toUpperCase()
  if (instrumentType === 'SPOT' || instrumentType === 'EQ' || instrumentType === 'INDEX')
    return false
  if (DERIVATIVE_TYPES.has(instrumentType)) return true
  if (DERIVATIVE_SEGMENTS.has(exchange)) return true
  if (CASH_SEGMENTS.has(exchange)) return false
  return undefined
}

/** Volume capability: Indices have no traded volume; cash and derivative contracts do. */
export function volumeCapability(
  exchange: string,
  metadata: Record<string, unknown> = {}
): boolean {
  if (typeof metadata.hasVolume === 'boolean') return metadata.hasVolume
  const upperEx = (exchange || '').toUpperCase()
  if (upperEx.endsWith('_INDEX') || upperEx === 'GLOBAL_INDEX') return false
  const instrumentType = String(metadata.instrumenttype ?? '')
    .trim()
    .toUpperCase()
  if (instrumentType === 'INDEX' || instrumentType === 'IDX' || instrumentType === 'AMXIDX') {
    return false
  }
  return true
}

export interface ContractDetails {
  readonly isIndex: boolean
  readonly isEquity: boolean
  readonly isDerivative: boolean
  readonly isOption: boolean
  readonly isFuture: boolean
  readonly optionType?: 'CE' | 'PE'
  readonly strike?: number
  readonly expiry?: string
  readonly isExpired?: boolean
  readonly underlying?: string
}

/**
 * Parses contract facts for options, futures, equities, and indices.
 * Never alters or mutates stored expiry.
 */
export function parseContractDetails(
  symbol: string,
  exchange: string,
  metadata: Record<string, unknown> = {}
): ContractDetails {
  const cleanSym = (symbol || '').trim()
  const upperEx = (exchange || '').trim().toUpperCase()
  const instType = String(metadata.instrumenttype ?? '')
    .trim()
    .toUpperCase()

  const isIndex =
    upperEx.endsWith('_INDEX') ||
    upperEx === 'GLOBAL_INDEX' ||
    instType === 'INDEX' ||
    instType === 'IDX'

  const hasOi = openInterestCapability(upperEx, metadata) === true

  // Option detection
  const isOption =
    instType === 'CE' ||
    instType === 'PE' ||
    instType.startsWith('OPT') ||
    cleanSym.endsWith('CE') ||
    cleanSym.endsWith('PE')

  const optionType: 'CE' | 'PE' | undefined = isOption
    ? instType === 'PE' || cleanSym.endsWith('PE')
      ? 'PE'
      : 'CE'
    : undefined

  // Strike extraction
  let strike: number | undefined
  if (metadata.strike !== undefined && metadata.strike !== null) {
    const s = Number(metadata.strike)
    if (Number.isFinite(s) && s > 0) strike = s
  } else if (isOption) {
    // Attempt parse from symbol like NIFTY26NOV24000CE
    const match = cleanSym.match(/(\d+(?:\.\d+)?)(?:CE|PE)$/i)
    if (match?.[1]) {
      const s = Number(match[1])
      if (Number.isFinite(s) && s > 0) strike = s
    }
  }

  // Future detection
  const isFuture = !isOption && (instType.startsWith('FUT') || cleanSym.endsWith('FUT') || hasOi)

  const isDerivative = isOption || isFuture || hasOi
  const isEquity = !isIndex && !isDerivative

  // Expiry extraction
  const expiry = metadata.expiry ? String(metadata.expiry) : undefined

  let isExpired = false
  if (expiry) {
    try {
      const expDate = new Date(expiry)
      if (!Number.isNaN(expDate.getTime()) && expDate.getTime() < Date.now()) {
        isExpired = true
      }
    } catch {
      // ignore
    }
  }

  return {
    isIndex,
    isEquity,
    isDerivative,
    isOption,
    isFuture,
    optionType,
    strike,
    expiry,
    isExpired,
    underlying: metadata.name ? String(metadata.name) : cleanSym.split(/\d/)[0] || cleanSym,
  }
}

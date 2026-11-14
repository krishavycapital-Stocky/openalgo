/**
 * Advanced Multi-Condition & Multi-Timeframe Alert Engine.
 *
 * Supports TradingView-style multi-condition alerts (up to 5 conditions) with AND logic,
 * multi-timeframe candle resampling, indicator evaluations (EMA, SMA, RSI, MACD, Supertrend,
 * VWAP, Bollinger Bands, ATR, ADX), and advanced trigger controls.
 */

import {
  type Bar,
  type BarCondition,
  registerBarCondition,
  unregisterBarCondition,
} from 'openalgo-charts'

export type ConditionOperator =
  | 'crossing'
  | 'crossingUp'
  | 'crossingDown'
  | 'greaterThan'
  | 'lessThan'
  | 'enteringRange'
  | 'leavingRange'

export type OperandType = 'price' | 'indicator' | 'value'

export type BuiltinIndicatorType =
  | 'ema'
  | 'sma'
  | 'rsi'
  | 'macd'
  | 'supertrend'
  | 'vwap'
  | 'bollinger'
  | 'atr'
  | 'adx'

export type AlertTriggerMode = 'once' | 'everyTime' | 'oncePerBar' | 'oncePerBarClose'

export interface ConditionOperand {
  readonly type: OperandType
  readonly value?: number
  readonly upperValue?: number
  readonly indicator?: BuiltinIndicatorType
  readonly studyInstanceId?: string
  readonly plotKey?: string
  readonly period?: number
  readonly fastPeriod?: number
  readonly slowPeriod?: number
  readonly signalPeriod?: number
  readonly multiplier?: number
  readonly source?: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3'
}

export interface SingleAlertCondition {
  readonly id: string
  readonly timeframe: string // 'chart' | '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '1D'
  readonly left: ConditionOperand
  readonly operator: ConditionOperator
  readonly right: ConditionOperand
}

export interface AdvancedAlertConfig {
  readonly id: string
  readonly logic: 'and' | 'or'
  readonly conditions: readonly SingleAlertCondition[]
  readonly triggerMode: AlertTriggerMode
  readonly cooldownSeconds?: number
  readonly lastFiredBarTime?: number
  readonly lastFiredAt?: number
}

export const TIMEFRAME_OPTIONS: readonly { value: string; label: string; seconds: number }[] = [
  { value: 'chart', label: 'Chart interval', seconds: 0 },
  { value: '1m', label: '1 minute', seconds: 60 },
  { value: '3m', label: '3 minutes', seconds: 180 },
  { value: '5m', label: '5 minutes', seconds: 300 },
  { value: '15m', label: '15 minutes', seconds: 900 },
  { value: '30m', label: '30 minutes', seconds: 1800 },
  { value: '1h', label: '1 hour', seconds: 3600 },
  { value: '1D', label: '1 day', seconds: 86400 },
]

export function timeframeToSeconds(tf: string): number {
  const found = TIMEFRAME_OPTIONS.find((one) => one.value === tf)
  return found ? found.seconds : 0
}

/* ── Candle Resampling ───────────────────────────────────────────────────── */

/**
 * Resamples bars to a target timeframe without lookahead bias.
 * If target timeframe is 0 or less than base bar interval, returns bars as-is.
 */
export function resampleBars(bars: readonly Bar[], targetSeconds: number): Bar[] {
  if (targetSeconds <= 0 || bars.length === 0) return [...bars]

  const resampled: Bar[] = []
  let currentBucket: Bar | null = null
  let currentBucketTime = -1

  for (const bar of bars) {
    const bucketTime = Math.floor(bar.time / targetSeconds) * targetSeconds

    if (currentBucket === null || bucketTime !== currentBucketTime) {
      if (currentBucket !== null) {
        resampled.push(currentBucket)
      }
      currentBucketTime = bucketTime
      currentBucket = {
        time: bucketTime,
        open: bar.open,
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume ?? 0,
      }
    } else {
      currentBucket.high = Math.max(currentBucket.high, bar.high)
      currentBucket.low = Math.min(currentBucket.low, bar.low)
      currentBucket.close = bar.close
      if (bar.volume !== undefined) {
        currentBucket.volume = (currentBucket.volume ?? 0) + bar.volume
      }
    }
  }

  if (currentBucket !== null) {
    resampled.push(currentBucket)
  }

  return resampled
}

/* ── Indicator Mathematics ──────────────────────────────────────────────── */

export function extractSourceSeries(
  bars: readonly Bar[],
  source: ConditionOperand['source'] = 'close'
): number[] {
  return bars.map((b) => {
    switch (source) {
      case 'open':
        return b.open
      case 'high':
        return b.high
      case 'low':
        return b.low
      case 'hl2':
        return (b.high + b.low) / 2
      case 'hlc3':
        return (b.high + b.low + b.close) / 3
      default:
        return b.close
    }
  })
}

export function calculateSMA(data: readonly number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN)
  if (data.length < period || period <= 0) return result

  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += data[i]!
  }
  result[period - 1] = sum / period

  for (let i = period; i < data.length; i++) {
    sum += data[i]! - data[i - period]!
    result[i] = sum / period
  }
  return result
}

export function calculateEMA(data: readonly number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(NaN)
  if (data.length < period || period <= 0) return result

  const multiplier = 2 / (period + 1)
  let sum = 0
  for (let i = 0; i < period; i++) {
    sum += data[i]!
  }
  let prevEma = sum / period
  result[period - 1] = prevEma

  for (let i = period; i < data.length; i++) {
    prevEma = (data[i]! - prevEma) * multiplier + prevEma
    result[i] = prevEma
  }
  return result
}

export function calculateRSI(data: readonly number[], period = 14): number[] {
  const result: number[] = new Array(data.length).fill(NaN)
  if (data.length <= period || period <= 0) return result

  let gainSum = 0
  let lossSum = 0

  for (let i = 1; i <= period; i++) {
    const diff = data[i]! - data[i - 1]!
    if (diff >= 0) gainSum += diff
    else lossSum -= diff
  }

  let avgGain = gainSum / period
  let avgLoss = lossSum / period

  if (avgLoss === 0) {
    result[period] = 100
  } else {
    const rs = avgGain / avgLoss
    result[period] = 100 - 100 / (1 + rs)
  }

  for (let i = period + 1; i < data.length; i++) {
    const diff = data[i]! - data[i - 1]!
    const gain = diff > 0 ? diff : 0
    const loss = diff < 0 ? -diff : 0

    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period

    if (avgLoss === 0) {
      result[i] = 100
    } else {
      const rs = avgGain / avgLoss
      result[i] = 100 - 100 / (1 + rs)
    }
  }

  return result
}

export function calculateMACD(
  data: readonly number[],
  fastPeriod = 12,
  slowPeriod = 26,
  signalPeriod = 9
): { macd: number[]; signal: number[]; hist: number[] } {
  const fastEma = calculateEMA(data, fastPeriod)
  const slowEma = calculateEMA(data, slowPeriod)

  const macd: number[] = new Array(data.length).fill(NaN)
  for (let i = 0; i < data.length; i++) {
    if (!Number.isNaN(fastEma[i]) && !Number.isNaN(slowEma[i])) {
      macd[i] = fastEma[i]! - slowEma[i]!
    }
  }

  // Calculate signal line (EMA of MACD)
  const validMacdStart = macd.findIndex((val) => !Number.isNaN(val))
  const signal: number[] = new Array(data.length).fill(NaN)
  const hist: number[] = new Array(data.length).fill(NaN)

  if (validMacdStart >= 0 && data.length - validMacdStart >= signalPeriod) {
    const macdSlice = macd.slice(validMacdStart)
    const signalSlice = calculateEMA(macdSlice, signalPeriod)
    for (let i = 0; i < signalSlice.length; i++) {
      const targetIdx = validMacdStart + i
      signal[targetIdx] = signalSlice[i]!
      if (!Number.isNaN(macd[targetIdx]) && !Number.isNaN(signalSlice[i])) {
        hist[targetIdx] = macd[targetIdx]! - signalSlice[i]!
      }
    }
  }

  return { macd, signal, hist }
}

export function calculateSupertrend(
  bars: readonly Bar[],
  period = 10,
  multiplier = 3
): { supertrend: number[]; direction: number[] } {
  const len = bars.length
  const st: number[] = new Array(len).fill(NaN)
  const dir: number[] = new Array(len).fill(1) // 1 = uptrend, -1 = downtrend

  if (len < period || period <= 0) return { supertrend: st, direction: dir }

  // True Range
  const tr: number[] = new Array(len)
  tr[0] = bars[0]!.high - bars[0]!.low
  for (let i = 1; i < len; i++) {
    const hl = bars[i]!.high - bars[i]!.low
    const hc = Math.abs(bars[i]!.high - bars[i - 1]!.close)
    const lc = Math.abs(bars[i]!.low - bars[i - 1]!.close)
    tr[i] = Math.max(hl, hc, lc)
  }

  // ATR (Wilder's Smoothing)
  const atr: number[] = new Array(len).fill(NaN)
  let trSum = 0
  for (let i = 0; i < period; i++) trSum += tr[i]!
  atr[period - 1] = trSum / period
  for (let i = period; i < len; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period
  }

  const basicUpper: number[] = new Array(len)
  const basicLower: number[] = new Array(len)
  const finalUpper: number[] = new Array(len).fill(0)
  const finalLower: number[] = new Array(len).fill(0)

  for (let i = period - 1; i < len; i++) {
    const hl2 = (bars[i]!.high + bars[i]!.low) / 2
    basicUpper[i] = hl2 + multiplier * atr[i]!
    basicLower[i] = hl2 - multiplier * atr[i]!

    if (i === period - 1) {
      finalUpper[i] = basicUpper[i]!
      finalLower[i] = basicLower[i]!
      st[i] = finalLower[i]!
      dir[i] = 1
    } else {
      finalUpper[i] =
        basicUpper[i]! < finalUpper[i - 1]! || bars[i - 1]!.close > finalUpper[i - 1]!
          ? basicUpper[i]!
          : finalUpper[i - 1]!
      finalLower[i] =
        basicLower[i]! > finalLower[i - 1]! || bars[i - 1]!.close < finalLower[i - 1]!
          ? basicLower[i]!
          : finalLower[i - 1]!

      if (dir[i - 1] === 1) {
        if (bars[i]!.close < finalLower[i]!) {
          dir[i] = -1
          st[i] = finalUpper[i]!
        } else {
          dir[i] = 1
          st[i] = finalLower[i]!
        }
      } else {
        if (bars[i]!.close > finalUpper[i]!) {
          dir[i] = 1
          st[i] = finalLower[i]!
        } else {
          dir[i] = -1
          st[i] = finalUpper[i]!
        }
      }
    }
  }

  return { supertrend: st, direction: dir }
}

export function calculateVWAP(bars: readonly Bar[]): number[] {
  const result: number[] = new Array(bars.length).fill(NaN)
  let cumulativePv = 0
  let cumulativeVol = 0

  for (let i = 0; i < bars.length; i++) {
    const b = bars[i]!
    const vol = b.volume ?? 1
    const typicalPrice = (b.high + b.low + b.close) / 3
    cumulativePv += typicalPrice * vol
    cumulativeVol += vol
    result[i] = cumulativeVol > 0 ? cumulativePv / cumulativeVol : typicalPrice
  }
  return result
}

export function calculateBollingerBands(
  data: readonly number[],
  period = 20,
  stdDevMultiplier = 2
): { middle: number[]; upper: number[]; lower: number[] } {
  const middle = calculateSMA(data, period)
  const upper: number[] = new Array(data.length).fill(NaN)
  const lower: number[] = new Array(data.length).fill(NaN)

  for (let i = period - 1; i < data.length; i++) {
    let sumSquares = 0
    const mean = middle[i]!
    for (let j = 0; j < period; j++) {
      const diff = data[i - j]! - mean
      sumSquares += diff * diff
    }
    const stdDev = Math.sqrt(sumSquares / period)
    upper[i] = mean + stdDevMultiplier * stdDev
    lower[i] = mean - stdDevMultiplier * stdDev
  }

  return { middle, upper, lower }
}

export function calculateATR(bars: readonly Bar[], period = 14): number[] {
  const len = bars.length
  const atr: number[] = new Array(len).fill(NaN)
  if (len < period || period <= 0) return atr

  const tr: number[] = new Array(len)
  tr[0] = bars[0]!.high - bars[0]!.low
  for (let i = 1; i < len; i++) {
    const hl = bars[i]!.high - bars[i]!.low
    const hc = Math.abs(bars[i]!.high - bars[i - 1]!.close)
    const lc = Math.abs(bars[i]!.low - bars[i - 1]!.close)
    tr[i] = Math.max(hl, hc, lc)
  }

  let trSum = 0
  for (let i = 0; i < period; i++) trSum += tr[i]!
  atr[period - 1] = trSum / period
  for (let i = period; i < len; i++) {
    atr[i] = (atr[i - 1]! * (period - 1) + tr[i]!) / period
  }
  return atr
}

export function calculateADX(
  bars: readonly Bar[],
  period = 14
): { adx: number[]; plusDi: number[]; minusDi: number[] } {
  const len = bars.length
  const adx: number[] = new Array(len).fill(NaN)
  const plusDi: number[] = new Array(len).fill(NaN)
  const minusDi: number[] = new Array(len).fill(NaN)

  if (len < period * 2 || period <= 0) return { adx, plusDi, minusDi }

  const tr: number[] = new Array(len).fill(0)
  const plusDm: number[] = new Array(len).fill(0)
  const minusDm: number[] = new Array(len).fill(0)

  for (let i = 1; i < len; i++) {
    const cur = bars[i]!
    const prev = bars[i - 1]!

    const hl = cur.high - cur.low
    const hc = Math.abs(cur.high - prev.close)
    const lc = Math.abs(cur.low - prev.close)
    tr[i] = Math.max(hl, hc, lc)

    const upMove = cur.high - prev.high
    const downMove = prev.low - cur.low

    if (upMove > downMove && upMove > 0) {
      plusDm[i] = upMove
    }
    if (downMove > upMove && downMove > 0) {
      minusDm[i] = downMove
    }
  }

  let trSmooth = 0
  let plusDmSmooth = 0
  let minusDmSmooth = 0

  for (let i = 1; i <= period; i++) {
    trSmooth += tr[i]!
    plusDmSmooth += plusDm[i]!
    minusDmSmooth += minusDm[i]!
  }

  const dx: number[] = new Array(len).fill(NaN)

  plusDi[period] = trSmooth > 0 ? (100 * plusDmSmooth) / trSmooth : 0
  minusDi[period] = trSmooth > 0 ? (100 * minusDmSmooth) / trSmooth : 0
  const diSum = plusDi[period]! + minusDi[period]!
  dx[period] = diSum > 0 ? (100 * Math.abs(plusDi[period]! - minusDi[period]!)) / diSum : 0

  for (let i = period + 1; i < len; i++) {
    trSmooth = trSmooth - trSmooth / period + tr[i]!
    plusDmSmooth = plusDmSmooth - plusDmSmooth / period + plusDm[i]!
    minusDmSmooth = minusDmSmooth - minusDmSmooth / period + minusDm[i]!

    plusDi[i] = trSmooth > 0 ? (100 * plusDmSmooth) / trSmooth : 0
    minusDi[i] = trSmooth > 0 ? (100 * minusDmSmooth) / trSmooth : 0

    const currentDiSum = plusDi[i]! + minusDi[i]!
    dx[i] = currentDiSum > 0 ? (100 * Math.abs(plusDi[i]! - minusDi[i]!)) / currentDiSum : 0
  }

  let dxSum = 0
  for (let i = period; i < period * 2 - 1; i++) {
    dxSum += dx[i]!
  }
  let adxSmooth = (dxSum + dx[period * 2 - 1]!) / period
  adx[period * 2 - 1] = adxSmooth

  for (let i = period * 2; i < len; i++) {
    adxSmooth = (adxSmooth * (period - 1) + dx[i]!) / period
    adx[i] = adxSmooth
  }

  return { adx, plusDi, minusDi }
}

/* ── Operand Value Evaluation ───────────────────────────────────────────── */

export function resolveOperandSeries(
  operand: ConditionOperand,
  bars: readonly Bar[],
  chartIndicators?: Record<string, readonly (number | null)[]>
): number[] {
  if (operand.type === 'value') {
    const val = operand.value ?? 0
    return new Array(bars.length).fill(val)
  }

  if (operand.type === 'price') {
    return extractSourceSeries(bars, operand.source)
  }

  // Indicator:
  if (operand.type === 'indicator') {
    // Check if reading from an active chart study instance
    if (operand.studyInstanceId && operand.plotKey && chartIndicators) {
      const plotValues = chartIndicators[operand.plotKey]
      if (plotValues && plotValues.length > 0) {
        return plotValues.map((v) => (v !== null && Number.isFinite(v) ? v : NaN))
      }
    }

    // Builtin indicators:
    const sourceData = extractSourceSeries(bars, operand.source)

    switch (operand.indicator) {
      case 'sma':
        return calculateSMA(sourceData, operand.period ?? 20)
      case 'ema':
        return calculateEMA(sourceData, operand.period ?? 20)
      case 'rsi':
        return calculateRSI(sourceData, operand.period ?? 14)
      case 'macd': {
        const res = calculateMACD(
          sourceData,
          operand.fastPeriod ?? 12,
          operand.slowPeriod ?? 26,
          operand.signalPeriod ?? 9
        )
        return operand.plotKey === 'signal'
          ? res.signal
          : operand.plotKey === 'hist'
            ? res.hist
            : res.macd
      }
      case 'supertrend': {
        const res = calculateSupertrend(bars, operand.period ?? 10, operand.multiplier ?? 3)
        return operand.plotKey === 'direction' ? res.direction : res.supertrend
      }
      case 'vwap':
        return calculateVWAP(bars)
      case 'bollinger': {
        const res = calculateBollingerBands(
          sourceData,
          operand.period ?? 20,
          operand.multiplier ?? 2
        )
        return operand.plotKey === 'upper'
          ? res.upper
          : operand.plotKey === 'lower'
            ? res.lower
            : res.middle
      }
      case 'atr':
        return calculateATR(bars, operand.period ?? 14)
      case 'adx': {
        const res = calculateADX(bars, operand.period ?? 14)
        return operand.plotKey === 'plusDi'
          ? res.plusDi
          : operand.plotKey === 'minusDi'
            ? res.minusDi
            : res.adx
      }
      default:
        return sourceData
    }
  }

  return new Array(bars.length).fill(NaN)
}

/* ── Condition Evaluation ────────────────────────────────────────────────── */

export function evaluateSingleCondition(
  condition: SingleAlertCondition,
  baseBars: readonly Bar[],
  chartIndicators?: Record<string, readonly (number | null)[]>
): boolean {
  if (baseBars.length < 2) return false

  // Handle Multi-Timeframe Resampling:
  const tfSeconds = timeframeToSeconds(condition.timeframe)
  const bars = tfSeconds > 0 ? resampleBars(baseBars, tfSeconds) : baseBars

  if (bars.length < 2) return false

  const leftSeries = resolveOperandSeries(condition.left, bars, chartIndicators)
  const rightSeries = resolveOperandSeries(condition.right, bars, chartIndicators)

  const curIdx = bars.length - 1
  const prevIdx = bars.length - 2

  const curLeft = leftSeries[curIdx]
  const prevLeft = leftSeries[prevIdx]
  const curRight = rightSeries[curIdx]
  const prevRight = rightSeries[prevIdx]

  if (
    curLeft === undefined ||
    prevLeft === undefined ||
    curRight === undefined ||
    prevRight === undefined ||
    Number.isNaN(curLeft) ||
    Number.isNaN(curRight)
  ) {
    return false
  }

  switch (condition.operator) {
    case 'crossing':
      return (
        (prevLeft <= prevRight && curLeft > curRight) ||
        (prevLeft >= prevRight && curLeft < curRight)
      )

    case 'crossingUp':
      return prevLeft <= prevRight && curLeft > curRight

    case 'crossingDown':
      return prevLeft >= prevRight && curLeft < curRight

    case 'greaterThan':
      return curLeft > curRight

    case 'lessThan':
      return curLeft < curRight

    case 'enteringRange': {
      const lower = condition.right.value ?? curRight
      const upper = condition.right.upperValue ?? lower
      const minBound = Math.min(lower, upper)
      const maxBound = Math.max(lower, upper)
      const wasInside = prevLeft >= minBound && prevLeft <= maxBound
      const isInside = curLeft >= minBound && curLeft <= maxBound
      return !wasInside && isInside
    }

    case 'leavingRange': {
      const lower = condition.right.value ?? curRight
      const upper = condition.right.upperValue ?? lower
      const minBound = Math.min(lower, upper)
      const maxBound = Math.max(lower, upper)
      const wasInside = prevLeft >= minBound && prevLeft <= maxBound
      const isInside = curLeft >= minBound && curLeft <= maxBound
      return wasInside && !isInside
    }

    default:
      return false
  }
}

/**
 * Evaluates all conditions of an advanced multi-condition alert.
 * Uses AND logic (all conditions must be true).
 */
export function evaluateAdvancedAlert(
  config: AdvancedAlertConfig,
  baseBars: readonly Bar[],
  chartIndicators?: Record<string, readonly (number | null)[]>
): boolean {
  if (config.conditions.length === 0) return false

  if (config.logic === 'or') {
    for (const cond of config.conditions) {
      if (evaluateSingleCondition(cond, baseBars, chartIndicators)) return true
    }
    return false
  }

  // Default: AND logic
  for (const cond of config.conditions) {
    if (!evaluateSingleCondition(cond, baseBars, chartIndicators)) {
      return false
    }
  }
  return true
}

/* ── BarCondition Registration for OpenAlgo-Charts ────────────────────────── */

const registeredConditions = new Map<string, AdvancedAlertConfig>()

/**
 * Registers an advanced multi-condition alert into openalgo-charts' BarCondition system.
 * Returns the condition ID.
 */
export function registerAdvancedAlertCondition(config: AdvancedAlertConfig): string {
  const conditionId = `adv_alert_${config.id}`
  // Alert restoration may run more than once (for example during React remounts).
  // Keep the registered callback and refresh its configuration without registering
  // the same ID a second time in openalgo-charts.
  if (registeredConditions.has(conditionId)) {
    registeredConditions.set(conditionId, config)
    return conditionId
  }

  const barCondition: BarCondition = {
    id: conditionId,
    title: `Advanced Alert (${config.conditions.length} conditions)`,
    when: (context) => {
      const active = registeredConditions.get(conditionId)
      if (!active) return false
      return evaluateAdvancedAlert(active, context.bars)
    },
  }

  registerBarCondition(barCondition)
  registeredConditions.set(conditionId, config)
  return conditionId
}

export function unregisterAdvancedAlertCondition(configId: string): void {
  const conditionId = `adv_alert_${configId}`
  registeredConditions.delete(conditionId)
  unregisterBarCondition(conditionId)
}

export function getRegisteredAdvancedAlert(configId: string): AdvancedAlertConfig | undefined {
  return registeredConditions.get(`adv_alert_${configId}`)
}

export function syncRegisteredAdvancedAlerts(alerts: readonly { payload?: unknown }[]): void {
  for (const alert of alerts) {
    const payload = alert.payload as { advancedConfig?: AdvancedAlertConfig } | undefined
    if (payload?.advancedConfig) {
      registerAdvancedAlertCondition(payload.advancedConfig)
    }
  }
}

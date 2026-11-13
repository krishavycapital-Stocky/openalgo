import type { Bar } from 'openalgo-charts'
import { describe, expect, it } from 'vitest'
import {
  type AdvancedAlertConfig,
  calculateADX,
  calculateEMA,
  calculateMACD,
  calculateRSI,
  calculateSMA,
  calculateSupertrend,
  evaluateAdvancedAlert,
  evaluateSingleCondition,
  registerAdvancedAlertCondition,
  resampleBars,
  type SingleAlertCondition,
  unregisterAdvancedAlertCondition,
} from './advancedAlerts'

const makeBar = (
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100
): Bar => ({
  time,
  open,
  high,
  low,
  close,
  volume,
})

describe('multi-timeframe candle resampling', () => {
  it('resamples five 1-minute bars into one 5-minute bar accurately', () => {
    const bars1m: Bar[] = [
      makeBar(60, 100, 105, 99, 102, 10),
      makeBar(120, 102, 108, 101, 104, 20),
      makeBar(180, 104, 106, 98, 99, 15),
      makeBar(240, 99, 103, 99, 101, 25),
      makeBar(300, 101, 107, 100, 106, 30), // bucket 300
    ]

    const resampled = resampleBars(bars1m, 300) // 5m = 300s
    expect(resampled.length).toBe(2)

    // First bucket (0 - 299s): bars at 60, 120, 180, 240
    const b0 = resampled[0]!
    expect(b0.open).toBe(100)
    expect(b0.high).toBe(108) // max of 105, 108, 106, 103
    expect(b0.low).toBe(98) // min of 99, 101, 98, 99
    expect(b0.close).toBe(101) // last close
    expect(b0.volume).toBe(70) // 10 + 20 + 15 + 25

    // Second bucket (300s): bar at 300
    const b1 = resampled[1]!
    expect(b1.time).toBe(300)
    expect(b1.open).toBe(101)
    expect(b1.high).toBe(107)
    expect(b1.low).toBe(100)
    expect(b1.close).toBe(106)
    expect(b1.volume).toBe(30)
  })

  it('preserves base bars when target interval is 0 or less than base interval', () => {
    const bars: Bar[] = [makeBar(60, 10, 12, 9, 11), makeBar(120, 11, 13, 10, 12)]
    expect(resampleBars(bars, 0)).toEqual(bars)
  })
})

describe('technical indicators calculation', () => {
  it('computes SMA correctly', () => {
    const data = [10, 20, 30, 40, 50]
    const sma3 = calculateSMA(data, 3)
    expect(sma3[0]).toBeNaN()
    expect(sma3[1]).toBeNaN()
    expect(sma3[2]).toBe(20) // (10+20+30)/3
    expect(sma3[3]).toBe(30) // (20+30+40)/3
    expect(sma3[4]).toBe(40) // (30+40+50)/3
  })

  it('computes EMA correctly', () => {
    const data = [10, 20, 30, 40, 50]
    const ema3 = calculateEMA(data, 3)
    expect(ema3[0]).toBeNaN()
    expect(ema3[1]).toBeNaN()
    expect(ema3[2]).toBe(20) // initial SMA
    // Multiplier = 2 / (3 + 1) = 0.5
    // ema3[3] = (40 - 20) * 0.5 + 20 = 30
    expect(ema3[3]).toBe(30)
    // ema3[4] = (50 - 30) * 0.5 + 30 = 40
    expect(ema3[4]).toBe(40)
  })

  it('computes RSI within bounds [0, 100]', () => {
    const data: number[] = []
    let p = 100
    for (let i = 0; i < 30; i++) {
      p += i % 2 === 0 ? 2 : -1
      data.push(p)
    }
    const rsi = calculateRSI(data, 14)
    const valid = rsi.filter((val) => !Number.isNaN(val))
    expect(valid.length).toBeGreaterThan(0)
    for (const v of valid) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })

  it('computes MACD line, signal line, and histogram', () => {
    const data: number[] = []
    for (let i = 0; i < 50; i++) data.push(100 + i * 0.5)
    const macdRes = calculateMACD(data, 12, 26, 9)
    expect(macdRes.macd.length).toBe(50)
    expect(macdRes.signal.length).toBe(50)
    expect(macdRes.hist.length).toBe(50)
    expect(Number.isFinite(macdRes.macd[49]!)).toBe(true)
  })

  it('computes Supertrend and direction', () => {
    const bars: Bar[] = []
    for (let i = 0; i < 30; i++) {
      const c = 100 + i * 2
      bars.push(makeBar(i * 60, c - 1, c + 2, c - 2, c))
    }
    const stRes = calculateSupertrend(bars, 10, 3)
    expect(stRes.supertrend.length).toBe(30)
    expect(stRes.direction.length).toBe(30)
    expect(stRes.direction[29]).toBe(1) // Uptrend
  })

  it('computes ADX, +DI, and -DI within expected bounds', () => {
    const bars: Bar[] = []
    for (let i = 0; i < 40; i++) {
      const c = 100 + i * 1.5
      bars.push(makeBar(i * 60, c - 1, c + 2, c - 2, c))
    }
    const adxRes = calculateADX(bars, 14)
    expect(adxRes.adx.length).toBe(40)
    expect(adxRes.plusDi.length).toBe(40)
    expect(adxRes.minusDi.length).toBe(40)

    const validAdx = adxRes.adx.filter((val) => !Number.isNaN(val))
    expect(validAdx.length).toBeGreaterThan(0)
    for (const v of validAdx) {
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThanOrEqual(100)
    }
  })
})

describe('single condition evaluations', () => {
  it('detects price crossing above a threshold', () => {
    const bars: Bar[] = [
      makeBar(60, 95, 98, 94, 98),
      makeBar(120, 98, 104, 97, 102), // crosses 100
    ]

    const condition: SingleAlertCondition = {
      id: 'c1',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'crossingUp',
      right: { type: 'value', value: 100 },
    }

    expect(evaluateSingleCondition(condition, bars)).toBe(true)
  })

  it('detects EMA crossover (EMA 3 crosses above EMA 5)', () => {
    // Generate bars where shorter EMA is below, then crosses above on the final bar
    const bars: Bar[] = []
    const prices = [100, 98, 96, 94, 92, 90, 88, 86, 84, 84, 96]
    for (const [i, p] of prices.entries()) {
      bars.push(makeBar(i * 60, p, p + 1, p - 1, p))
    }

    const condition: SingleAlertCondition = {
      id: 'c_cross',
      timeframe: 'chart',
      left: { type: 'indicator', indicator: 'ema', period: 3 },
      operator: 'crossingUp',
      right: { type: 'indicator', indicator: 'ema', period: 5 },
    }

    expect(evaluateSingleCondition(condition, bars)).toBe(true)
  })

  it('detects channel entering and leaving range', () => {
    const barsEnter: Bar[] = [
      makeBar(60, 80, 85, 75, 80), // outside [90, 110]
      makeBar(120, 85, 102, 85, 100), // inside [90, 110]
    ]

    const enterCondition: SingleAlertCondition = {
      id: 'c_range',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'enteringRange',
      right: { type: 'value', value: 90, upperValue: 110 },
    }

    expect(evaluateSingleCondition(enterCondition, barsEnter)).toBe(true)
  })
})

describe('multi-condition and multi-timeframe alert evaluation', () => {
  it('evaluates multi-condition alert with AND logic (1m EMA crossover AND 5m RSI AND Price level)', () => {
    // Generate 40 1-minute bars
    const bars: Bar[] = []
    let price = 100
    for (let i = 0; i < 40; i++) {
      if (i > 30)
        price += 3 // sharp rise at the end
      else price += i % 2 === 0 ? 0.5 : -0.3
      bars.push(makeBar(i * 60, price - 0.5, price + 1, price - 1, price, 50))
    }

    const config: AdvancedAlertConfig = {
      id: 'adv-tv-alert',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        // Condition 1: 1-minute EMA 3 crosses above EMA 7
        {
          id: 'c1',
          timeframe: '1m',
          left: { type: 'indicator', indicator: 'ema', period: 3 },
          operator: 'greaterThan',
          right: { type: 'indicator', indicator: 'ema', period: 7 },
        },
        // Condition 2: 5-minute RSI > 50
        {
          id: 'c2',
          timeframe: '5m',
          left: { type: 'indicator', indicator: 'rsi', period: 5 },
          operator: 'greaterThan',
          right: { type: 'value', value: 50 },
        },
        // Condition 3: Price > 105
        {
          id: 'c3',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 105 },
        },
      ],
    }

    const fired = evaluateAdvancedAlert(config, bars)
    expect(fired).toBe(true)
  })

  it('fails when any condition in AND logic is false', () => {
    const bars: Bar[] = [makeBar(60, 100, 101, 99, 100), makeBar(120, 100, 103, 100, 102)]

    const config: AdvancedAlertConfig = {
      id: 'adv-fail',
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 101 }, // true (102 > 101)
        },
        {
          id: 'c2',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 200 }, // false (102 not > 200)
        },
      ],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(false)
  })

  it('registers and unregisters cleanly with OpenAlgo Charts BarCondition system', () => {
    const config: AdvancedAlertConfig = {
      id: 'reg-test-1',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'cond1',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 50 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    expect(condId).toBe('adv_alert_reg-test-1')

    unregisterAdvancedAlertCondition('reg-test-1')
  })
})

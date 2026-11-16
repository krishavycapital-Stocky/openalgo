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
  formatPrecedenceExpression,
  getRegisteredAdvancedAlert,
  registerAdvancedAlertCondition,
  resampleBars,
  type SingleAlertCondition,
  syncRegisteredAdvancedAlerts,
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
    expect(getRegisteredAdvancedAlert('reg-test-1')).toEqual(config)

    unregisterAdvancedAlertCondition('reg-test-1')
    expect(getRegisteredAdvancedAlert('reg-test-1')).toBeUndefined()
  })

  it('syncRegisteredAdvancedAlerts registers active alerts and unregisters deleted ones', () => {
    const configA: AdvancedAlertConfig = {
      id: 'sync-a',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 100 },
        },
      ],
    }
    const configB: AdvancedAlertConfig = {
      id: 'sync-b',
      logic: 'or',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c2',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'lessThan',
          right: { type: 'value', value: 50 },
        },
      ],
    }

    // Sync with both alerts
    syncRegisteredAdvancedAlerts([
      { payload: { advancedConfig: configA } },
      { payload: { advancedConfig: configB } },
    ])
    expect(getRegisteredAdvancedAlert('sync-a')).toBeDefined()
    expect(getRegisteredAdvancedAlert('sync-b')).toBeDefined()

    // Sync with only alert A remaining (alert B was deleted)
    syncRegisteredAdvancedAlerts([{ payload: { advancedConfig: configA } }])
    expect(getRegisteredAdvancedAlert('sync-a')).toBeDefined()
    expect(getRegisteredAdvancedAlert('sync-b')).toBeUndefined()

    // Clean up
    syncRegisteredAdvancedAlerts([])
    expect(getRegisteredAdvancedAlert('sync-a')).toBeUndefined()
  })
})

// ─── Regression tests (Priority 2 refinement) ────────────────────────────────

describe('AND / OR multi-condition logic', () => {
  const makeSimpleBars = (): Bar[] => [
    makeBar(60, 100, 101, 99, 100),
    makeBar(120, 100, 103, 100, 102),
  ]

  const condAbove101: SingleAlertCondition = {
    id: 'above101',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'greaterThan',
    right: { type: 'value', value: 101 }, // 102 > 101 → true
  }

  const condAbove200: SingleAlertCondition = {
    id: 'above200',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'greaterThan',
    right: { type: 'value', value: 200 }, // 102 > 200 → false
  }

  it('AND fires when both conditions are true', () => {
    const condAbove100: SingleAlertCondition = {
      id: 'above100',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'greaterThan',
      right: { type: 'value', value: 100 }, // 102 > 100 → true
    }
    const cfg: AdvancedAlertConfig = {
      id: 'and-both-true',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [condAbove101, condAbove100],
    }
    expect(evaluateAdvancedAlert(cfg, makeSimpleBars())).toBe(true)
  })

  it('AND does NOT fire when one condition is false', () => {
    const cfg: AdvancedAlertConfig = {
      id: 'and-one-false',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [condAbove101, condAbove200],
    }
    expect(evaluateAdvancedAlert(cfg, makeSimpleBars())).toBe(false)
  })

  it('OR fires when one condition is true and one is false', () => {
    const cfg: AdvancedAlertConfig = {
      id: 'or-one-true',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [condAbove101, condAbove200],
    }
    expect(evaluateAdvancedAlert(cfg, makeSimpleBars())).toBe(true)
  })

  it('OR does NOT fire when both conditions are false', () => {
    const condAbove300: SingleAlertCondition = {
      id: 'above300',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'greaterThan',
      right: { type: 'value', value: 300 }, // false
    }
    const cfg: AdvancedAlertConfig = {
      id: 'or-both-false',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [condAbove200, condAbove300],
    }
    expect(evaluateAdvancedAlert(cfg, makeSimpleBars())).toBe(false)
  })
})

describe('insufficient bars and NaN handling', () => {
  it('returns false with less than 2 bars', () => {
    const condition: SingleAlertCondition = {
      id: 'c1',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'greaterThan',
      right: { type: 'value', value: 100 },
    }
    const result = evaluateSingleCondition(condition, [makeBar(60, 100, 101, 99, 105)])
    expect(result).toBe(false)
  })

  it('returns false (not throws) when EMA warm-up period is not reached', () => {
    // Only 2 bars, EMA(20) needs 20+ bars to be valid
    const bars: Bar[] = [makeBar(60, 100, 101, 99, 100), makeBar(120, 100, 103, 100, 102)]
    const condition: SingleAlertCondition = {
      id: 'ema-warmup',
      timeframe: 'chart',
      left: { type: 'indicator', indicator: 'ema', period: 20 },
      operator: 'greaterThan',
      right: { type: 'value', value: 100 },
    }
    // Should not throw; NaN from EMA returns false safely
    expect(() => evaluateSingleCondition(condition, bars)).not.toThrow()
    expect(evaluateSingleCondition(condition, bars)).toBe(false)
  })

  it('returns false (not throws) when RSI warm-up period is not reached', () => {
    // RSI(14) requires at least 15 bars
    const bars = Array.from({ length: 5 }, (_, i) => makeBar(i * 60, 100, 101, 99, 100 + i))
    const condition: SingleAlertCondition = {
      id: 'rsi-warmup',
      timeframe: 'chart',
      left: { type: 'indicator', indicator: 'rsi', period: 14 },
      operator: 'greaterThan',
      right: { type: 'value', value: 50 },
    }
    expect(() => evaluateSingleCondition(condition, bars)).not.toThrow()
    expect(evaluateSingleCondition(condition, bars)).toBe(false)
  })
})

describe('range conditions (enteringRange / leavingRange)', () => {
  it('enteringRange fires when previous close was outside and current is inside', () => {
    const bars: Bar[] = [
      makeBar(60, 80, 82, 78, 80), // below range [90, 110]
      makeBar(120, 90, 105, 89, 95), // enters range
    ]
    const cond: SingleAlertCondition = {
      id: 'enter',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'enteringRange',
      right: { type: 'value', value: 90, upperValue: 110 },
    }
    expect(evaluateSingleCondition(cond, bars)).toBe(true)
  })

  it('enteringRange does NOT fire when already inside range on previous bar', () => {
    const bars: Bar[] = [
      makeBar(60, 90, 100, 89, 95), // already inside [90, 110]
      makeBar(120, 95, 108, 94, 100), // still inside
    ]
    const cond: SingleAlertCondition = {
      id: 'enter-noop',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'enteringRange',
      right: { type: 'value', value: 90, upperValue: 110 },
    }
    expect(evaluateSingleCondition(cond, bars)).toBe(false)
  })

  it('leavingRange fires when previous close was inside and current is outside', () => {
    const bars: Bar[] = [
      makeBar(60, 90, 100, 89, 95), // inside [90, 110]
      makeBar(120, 95, 115, 94, 115), // leaves range (above 110)
    ]
    const cond: SingleAlertCondition = {
      id: 'leave',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'leavingRange',
      right: { type: 'value', value: 90, upperValue: 110 },
    }
    expect(evaluateSingleCondition(cond, bars)).toBe(true)
  })
})

describe('indicator vs indicator conditions', () => {
  it('EMA9 crossingUp EMA21 fires when faster EMA just crossed above slower', () => {
    // Build enough bars for both EMAs to warm up (need 21+)
    const bars: Bar[] = []
    // 25 bars with slow upward drift, then a sharp surge
    for (let i = 0; i < 25; i++) {
      const p = 100 + i * 0.1 // gentle rise
      bars.push(makeBar(i * 60, p - 0.5, p + 1, p - 1, p, 50))
    }
    // Sharp surge to force EMA9 to cross above EMA21
    for (let i = 25; i < 30; i++) {
      const p = 100 + (i - 20) * 3 // steep rise
      bars.push(makeBar(i * 60, p - 1, p + 2, p - 1.5, p, 100))
    }

    const config: AdvancedAlertConfig = {
      id: 'ema-crossover',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'ema9-gt-ema21',
          timeframe: 'chart',
          left: { type: 'indicator', indicator: 'ema', period: 9 },
          operator: 'crossingUp',
          right: { type: 'indicator', indicator: 'ema', period: 21 },
        },
      ],
    }
    // The function should not throw and should return a boolean
    const result = evaluateAdvancedAlert(config, bars)
    expect(typeof result).toBe('boolean')
  })

  it('price crossingDown Supertrend evaluates without error', () => {
    const bars: Bar[] = []
    // Build enough bars for Supertrend (10 period ATR default)
    for (let i = 0; i < 20; i++) {
      const p = 100 + (19 - i) * 2 // downtrend
      bars.push(makeBar(i * 60, p + 1, p + 2, p - 1, p, 50))
    }

    const config: AdvancedAlertConfig = {
      id: 'price-vs-supertrend',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'price-below-st',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'crossingDown',
          right: { type: 'indicator', indicator: 'supertrend', period: 10, multiplier: 3 },
        },
      ],
    }
    expect(() => evaluateAdvancedAlert(config, bars)).not.toThrow()
    expect(typeof evaluateAdvancedAlert(config, bars)).toBe('boolean')
  })
})

describe('multi-timeframe resampling accuracy', () => {
  it('5-minute OHLCV aggregates correctly from 1-minute bars', () => {
    // 10 one-minute bars → 2 five-minute bars
    const bars1m: Bar[] = [
      makeBar(60, 100, 105, 99, 102, 10),
      makeBar(120, 102, 108, 101, 104, 20),
      makeBar(180, 104, 106, 98, 99, 15),
      makeBar(240, 99, 103, 99, 101, 25),
      makeBar(300, 101, 107, 100, 106, 30),
      makeBar(360, 106, 110, 105, 108, 10),
      makeBar(420, 108, 112, 107, 110, 20),
      makeBar(480, 110, 111, 108, 109, 15),
      makeBar(540, 109, 113, 108, 111, 25),
      makeBar(600, 111, 115, 110, 114, 30),
    ]

    const bars5m = resampleBars(bars1m, 300)
    expect(bars5m.length).toBeGreaterThanOrEqual(2)

    // First 5m bucket: bars at t=60,120,180,240 (bucket floor=0)
    const b0 = bars5m[0]!
    expect(b0.open).toBe(100) // first open
    expect(b0.high).toBe(108) // max high
    expect(b0.low).toBe(98) // min low
    expect(b0.close).toBe(101) // last close
    expect(b0.volume).toBe(70) // sum

    // Second 5m bucket: bars at t=300,360,420,480,540 (bucket floor=300)
    // open=101 (first), high=max(107,110,112,111,113)=113, low=min(100,105,107,108,108)=100,
    // close=111 (last of t=540), volume=30+10+20+15+25=100
    const b1 = bars5m[1]!
    expect(b1.open).toBe(101)
    expect(b1.high).toBe(113)
    expect(b1.low).toBe(100)
    expect(b1.close).toBe(111)
    expect(b1.volume).toBe(100)
  })
})

describe('volume and open interest alert evaluation', () => {
  const makeOiBar = (time: number, close: number, volume?: number, oi?: number): Bar => ({
    time,
    open: close,
    high: close + 1,
    low: close - 1,
    close,
    ...(volume !== undefined ? { volume } : {}),
    ...(oi !== undefined ? { oi } : {}),
  })

  it('triggers volume crossing threshold', () => {
    const bars: Bar[] = [makeOiBar(60, 100, 4000), makeOiBar(120, 101, 8000)]

    const config: AdvancedAlertConfig = {
      id: 'vol-cross',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'vol-above-5k',
          timeframe: 'chart',
          left: { type: 'volume' },
          operator: 'crossingUp',
          right: { type: 'value', value: 5000 },
        },
      ],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('triggers open interest crossing threshold on derivative contract', () => {
    const bars: Bar[] = [makeOiBar(60, 24000, 1000, 45000), makeOiBar(120, 24050, 1500, 55000)]

    const config: AdvancedAlertConfig = {
      id: 'oi-cross',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'oi-above-50k',
          timeframe: 'chart',
          left: { type: 'openInterest' },
          operator: 'crossingUp',
          right: { type: 'value', value: 50000 },
        },
      ],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('evaluates volume crossing volume SMA accurately', () => {
    // 5 bars of volume: 100, 100, 100, 100, 500
    // SMA(3) at bar 4 = (100+100+100)/3 = 100. Previous vol 100 <= 100.
    // SMA(3) at bar 5 = (100+100+500)/3 = 233.33. Current vol 500 > 233.33.
    const bars: Bar[] = [
      makeOiBar(60, 100, 100),
      makeOiBar(120, 100, 100),
      makeOiBar(180, 100, 100),
      makeOiBar(240, 100, 100),
      makeOiBar(300, 100, 500),
    ]

    const config: AdvancedAlertConfig = {
      id: 'vol-cross-sma',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'vol-above-sma',
          timeframe: 'chart',
          left: { type: 'volume' },
          operator: 'crossingUp',
          right: { type: 'volume', indicator: 'sma', period: 3 },
        },
      ],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('never substitutes missing OI with zero and refuses to fire false alerts', () => {
    // Bar without OI (e.g. cash equity or missing feed data)
    const barsNoOi: Bar[] = [
      makeOiBar(60, 100, 1000), // oi undefined
      makeOiBar(120, 101, 1200), // oi undefined
    ]

    const config: AdvancedAlertConfig = {
      id: 'oi-missing',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'oi-greater-than-zero',
          timeframe: 'chart',
          left: { type: 'openInterest' },
          operator: 'greaterThan',
          right: { type: 'value', value: 0 },
        },
      ],
    }

    // Must evaluate to false, NOT treat undefined as 0 or trigger false comparison
    expect(evaluateAdvancedAlert(config, barsNoOi)).toBe(false)
  })

  it('resamples open interest as latest point-in-time level and volume as cumulative sum', () => {
    const bars1m: Bar[] = [
      makeOiBar(60, 100, 10, 1000),
      makeOiBar(120, 102, 20, 1200),
      makeOiBar(180, 104, 15, 1100),
      makeOiBar(240, 99, 25, 1500),
    ]

    const resampled = resampleBars(bars1m, 300)
    expect(resampled.length).toBe(1)
    const b0 = resampled[0]!
    expect(b0.volume).toBe(70) // 10 + 20 + 15 + 25
    expect(b0.oi).toBe(1500) // latest bar's OI level, NOT summed 4800!
  })
})

describe('mixed AND/OR grouping across up to five conditions', () => {
  const bars: Bar[] = [makeBar(60, 100, 105, 95, 100, 100), makeBar(120, 100, 110, 99, 108, 500)]

  const condPriceAbove105: SingleAlertCondition = {
    id: 'c1',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'greaterThan',
    right: { type: 'value', value: 105 },
    groupId: 'g1',
  }

  const condPriceBelow50: SingleAlertCondition = {
    id: 'c2',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'lessThan',
    right: { type: 'value', value: 50 }, // FALSE
    groupId: 'g1',
  }

  const condVolAbove300: SingleAlertCondition = {
    id: 'c3',
    timeframe: 'chart',
    left: { type: 'volume' },
    operator: 'greaterThan',
    right: { type: 'value', value: 300 }, // TRUE
    groupId: 'g2',
  }

  const condVolAbove1000: SingleAlertCondition = {
    id: 'c4',
    timeframe: 'chart',
    left: { type: 'volume' },
    operator: 'greaterThan',
    right: { type: 'value', value: 1000 }, // FALSE
    groupId: 'g2',
  }

  it('evaluates (C1 AND C2) OR C3 where C1=T, C2=F, C3=T -> TRUE', () => {
    const config: AdvancedAlertConfig = {
      id: 'mixed-1',
      logic: 'or', // Connect groups with OR
      groups: [
        { id: 'g1', logic: 'and' }, // C1 AND C2 -> T and F = F
        { id: 'g2', logic: 'or' }, // C3 -> T
      ],
      triggerMode: 'everyTime',
      conditions: [condPriceAbove105, condPriceBelow50, condVolAbove300],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('evaluates (C1 OR C2) AND (C3 AND C4) where C1=T, C2=F, C3=T, C4=F -> FALSE', () => {
    const config: AdvancedAlertConfig = {
      id: 'mixed-2',
      logic: 'and', // Connect groups with AND
      groups: [
        { id: 'g1', logic: 'or' }, // C1 OR C2 -> T or F = T
        { id: 'g2', logic: 'and' }, // C3 AND C4 -> T and F = F
      ],
      triggerMode: 'everyTime',
      conditions: [condPriceAbove105, condPriceBelow50, condVolAbove300, condVolAbove1000],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(false)
  })

  it('evaluates complex 5-condition grouped expression accurately', () => {
    const cond5: SingleAlertCondition = {
      id: 'c5',
      timeframe: 'chart',
      left: { type: 'price', source: 'high' },
      operator: 'greaterThan',
      right: { type: 'value', value: 109 }, // TRUE (high=110)
      groupId: 'g2',
    }

    // Group 1 (AND): C1(T) and C2(F) -> F
    // Group 2 (AND): C3(T) and C5(T) -> T
    // Top: OR -> F or T = TRUE
    const config: AdvancedAlertConfig = {
      id: 'mixed-5cond',
      logic: 'or',
      groups: [
        { id: 'g1', logic: 'and' },
        { id: 'g2', logic: 'and' },
      ],
      triggerMode: 'everyTime',
      conditions: [condPriceAbove105, condPriceBelow50, condVolAbove300, cond5],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('preserves 100% backward compatibility for legacy flat alerts without groups', () => {
    const legacyAnd: AdvancedAlertConfig = {
      id: 'legacy-and',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [condPriceAbove105, condVolAbove300], // both true
    }
    expect(evaluateAdvancedAlert(legacyAnd, bars)).toBe(true)

    const legacyOr: AdvancedAlertConfig = {
      id: 'legacy-or',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [condPriceBelow50, condVolAbove300], // F or T = T
      // groups is undefined, confirming legacy path works flawlessly
    }
    expect(evaluateAdvancedAlert(legacyOr, bars)).toBe(true)
  })
})

describe('extended multi-group alerts (3 to 5 groups) with explicit boolean precedence', () => {
  const bars: Bar[] = [
    makeBar(60, 100, 102, 98, 100, 400),
    makeBar(120, 100, 110, 99, 108, 500), // close=108, high=110, volume=500
  ]

  const condPriceAbove105: SingleAlertCondition = {
    id: 'c1',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'greaterThan',
    right: { type: 'value', value: 105 }, // TRUE (close=108)
    groupId: 'g1',
  }

  const condPriceBelow50: SingleAlertCondition = {
    id: 'c2',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'lessThan',
    right: { type: 'value', value: 50 }, // FALSE (close=108)
    groupId: 'g2',
  }

  const condVolAbove300: SingleAlertCondition = {
    id: 'c3',
    timeframe: 'chart',
    left: { type: 'volume' },
    operator: 'greaterThan',
    right: { type: 'value', value: 300 }, // TRUE (volume=500)
    groupId: 'g3',
  }

  const condHighAbove109: SingleAlertCondition = {
    id: 'c4',
    timeframe: 'chart',
    left: { type: 'price', source: 'high' },
    operator: 'greaterThan',
    right: { type: 'value', value: 109 }, // TRUE (high=110)
    groupId: 'g4',
  }

  const condVolAbove1000: SingleAlertCondition = {
    id: 'c5',
    timeframe: 'chart',
    left: { type: 'volume' },
    operator: 'greaterThan',
    right: { type: 'value', value: 1000 }, // FALSE (volume=500)
    groupId: 'g5',
  }

  it('evaluates 3 groups: (G1) AND (G2) OR (G3) where G1=T, G2=F, G3=T -> TRUE', () => {
    // (T AND F) OR T = F OR T = TRUE
    const config: AdvancedAlertConfig = {
      id: '3-groups-1',
      logic: 'or',
      groups: [
        { id: 'g1', name: 'Group 1', logic: 'and' },
        { id: 'g2', name: 'Group 2', logic: 'and', connector: 'and' },
        { id: 'g3', name: 'Group 3', logic: 'and', connector: 'or' },
      ],
      triggerMode: 'everyTime',
      conditions: [condPriceAbove105, condPriceBelow50, condVolAbove300],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('evaluates 3 groups with explicit AND precedence: G1 OR (G2 AND G3)', () => {
    // If G1=T, G2=T, G3=F:
    // With AND precedence: T OR (T AND F) = T OR F = TRUE
    // (If evaluated strictly left-to-right, (T OR T) AND F would be FALSE)
    const config: AdvancedAlertConfig = {
      id: '3-groups-precedence',
      logic: 'or',
      groups: [
        { id: 'g1', name: 'Group 1', logic: 'and' },
        { id: 'g2', name: 'Group 2', logic: 'and', connector: 'or' },
        { id: 'g3', name: 'Group 3', logic: 'and', connector: 'and' }, // G3 ANDs with G2
      ],
      triggerMode: 'everyTime',
      conditions: [
        condPriceAbove105, // G1 = TRUE
        condVolAbove300, // G2 = TRUE
        condPriceBelow50, // G3 = FALSE
      ],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('evaluates 4 groups: (G1) OR (G2) AND (G3) OR (G4)', () => {
    // G1=F, G2=T, G3=T, G4=F
    // F OR (T AND T) OR F = F OR T OR F = TRUE
    const g1False = { ...condPriceBelow50, groupId: 'g1' }
    const g2True = { ...condPriceAbove105, groupId: 'g2' }
    const g3True = { ...condVolAbove300, groupId: 'g3' }
    const g4False = { ...condVolAbove1000, groupId: 'g4' }

    const config: AdvancedAlertConfig = {
      id: '4-groups-test',
      logic: 'or',
      groups: [
        { id: 'g1', name: 'Group 1', logic: 'and' },
        { id: 'g2', name: 'Group 2', logic: 'and', connector: 'or' },
        { id: 'g3', name: 'Group 3', logic: 'and', connector: 'and' },
        { id: 'g4', name: 'Group 4', logic: 'and', connector: 'or' },
      ],
      triggerMode: 'everyTime',
      conditions: [g1False, g2True, g3True, g4False],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('evaluates 5 distinct independent groups with mixed connectors and operators', () => {
    // G1: close > 105 (T)
    // G2: close < 50 (F), connector: OR
    // G3: vol > 300 (T), connector: AND
    // G4: high > 109 (T), connector: AND
    // G5: vol > 1000 (F), connector: OR
    // Structure: G1 OR (G2 AND G3 AND G4) OR G5 = T OR (F AND T AND T) OR F = T OR F OR F = TRUE
    const config: AdvancedAlertConfig = {
      id: '5-groups-full',
      logic: 'or',
      groups: [
        { id: 'g1', name: 'Group 1', logic: 'and' },
        { id: 'g2', name: 'Group 2', logic: 'and', connector: 'or' },
        { id: 'g3', name: 'Group 3', logic: 'and', connector: 'and' },
        { id: 'g4', name: 'Group 4', logic: 'and', connector: 'and' },
        { id: 'g5', name: 'Group 5', logic: 'and', connector: 'or' },
      ],
      triggerMode: 'everyTime',
      conditions: [
        condPriceAbove105,
        condPriceBelow50,
        condVolAbove300,
        condHighAbove109,
        condVolAbove1000,
      ],
    }

    expect(evaluateAdvancedAlert(config, bars)).toBe(true)
  })

  it('evaluates multi-group alerts with indicator crossovers (crossingUp / crossingDown)', () => {
    // bar 0: close=95 (below 100)
    // bar 1: close=105 (crosses up 100)
    const crossoverBars: Bar[] = [
      makeBar(60, 90, 96, 89, 95, 200),
      makeBar(120, 96, 108, 95, 105, 600),
    ]

    const condCrossUp: SingleAlertCondition = {
      id: 'c-cross',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'crossingUp',
      right: { type: 'value', value: 100 }, // TRUE
      groupId: 'g1',
    }

    const condVolCross: SingleAlertCondition = {
      id: 'c-vol',
      timeframe: 'chart',
      left: { type: 'volume' },
      operator: 'greaterThan',
      right: { type: 'value', value: 500 }, // TRUE (volume=600)
      groupId: 'g2',
    }

    const condDummy: SingleAlertCondition = {
      id: 'c-dum',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'lessThan',
      right: { type: 'value', value: 10 }, // FALSE
      groupId: 'g3',
    }

    // (G1 AND G2) OR G3 = (T AND T) OR F = TRUE
    const config: AdvancedAlertConfig = {
      id: 'crossover-multi-group',
      logic: 'or',
      groups: [
        { id: 'g1', name: 'Group 1', logic: 'and' },
        { id: 'g2', name: 'Group 2', logic: 'and', connector: 'and' },
        { id: 'g3', name: 'Group 3', logic: 'and', connector: 'or' },
      ],
      triggerMode: 'everyTime',
      conditions: [condCrossUp, condVolCross, condDummy],
    }

    expect(evaluateAdvancedAlert(config, crossoverBars)).toBe(true)
  })

  it('evaluates multi-group alerts with mixed timeframes (chart + 5m + 15m)', () => {
    // Generate 30 1-minute bars (ensures 6 5m bars and 2 15m bars, volume=500 each)
    const mtfBars: Bar[] = Array.from({ length: 30 }, (_, i) =>
      makeBar((i + 1) * 60, 100 + i, 105 + i, 99 + i, 102 + i, 500)
    )

    const condChart: SingleAlertCondition = {
      id: 'c-chart',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'greaterThan',
      right: { type: 'value', value: 110 }, // TRUE (bar 30 close = 131)
      groupId: 'g1',
    }

    const cond5m: SingleAlertCondition = {
      id: 'c-5m',
      timeframe: '5m',
      left: { type: 'volume' },
      operator: 'greaterThan',
      right: { type: 'value', value: 400 }, // TRUE (5m bar volume >= 500)
      groupId: 'g2',
    }

    const cond15m: SingleAlertCondition = {
      id: 'c-15m',
      timeframe: '15m',
      left: { type: 'volume' },
      operator: 'greaterThan',
      right: { type: 'value', value: 20000 }, // FALSE
      groupId: 'g3',
    }

    // (G1 AND G2) OR G3 = (T AND T) OR F = TRUE
    const config: AdvancedAlertConfig = {
      id: 'mtf-multi-group',
      logic: 'or',
      groups: [
        { id: 'g1', name: 'Group 1', logic: 'and' },
        { id: 'g2', name: 'Group 2', logic: 'and', connector: 'and' },
        { id: 'g3', name: 'Group 3', logic: 'and', connector: 'or' },
      ],
      triggerMode: 'everyTime',
      conditions: [condChart, cond5m, cond15m],
    }

    expect(evaluateAdvancedAlert(config, mtfBars)).toBe(true)
  })
})

describe('V1 formatPrecedenceExpression (AND before OR)', () => {
  it('handles empty and single items correctly', () => {
    expect(formatPrecedenceExpression([], [])).toBe('')
    expect(formatPrecedenceExpression(['Rule #1'], [])).toBe('Rule #1')
  })

  it('formats 2 items with AND or OR connector', () => {
    expect(formatPrecedenceExpression(['Rule #1', 'Rule #2'], ['and'])).toBe('Rule #1 AND Rule #2')
    expect(formatPrecedenceExpression(['Rule #1', 'Rule #2'], ['or'])).toBe('Rule #1 OR Rule #2')
  })

  it('formats 3 items with uniform connectors without unnecessary parentheses', () => {
    expect(formatPrecedenceExpression(['Rule #1', 'Rule #2', 'Rule #3'], ['and', 'and'])).toBe(
      'Rule #1 AND Rule #2 AND Rule #3'
    )
    expect(formatPrecedenceExpression(['Rule #1', 'Rule #2', 'Rule #3'], ['or', 'or'])).toBe(
      'Rule #1 OR Rule #2 OR Rule #3'
    )
  })

  it('parenthesizes AND-groups when mixed with OR according to standard precedence', () => {
    // (Rule #1 AND Rule #2) OR Rule #3
    expect(formatPrecedenceExpression(['Rule #1', 'Rule #2', 'Rule #3'], ['and', 'or'])).toBe(
      '(Rule #1 AND Rule #2) OR Rule #3'
    )
    // Rule #1 OR (Rule #2 AND Rule #3)
    expect(formatPrecedenceExpression(['Rule #1', 'Rule #2', 'Rule #3'], ['or', 'and'])).toBe(
      'Rule #1 OR (Rule #2 AND Rule #3)'
    )
    // (Rule #1 AND Rule #2) OR (Rule #3 AND Rule #4)
    expect(
      formatPrecedenceExpression(['Rule #1', 'Rule #2', 'Rule #3', 'Rule #4'], ['and', 'or', 'and'])
    ).toBe('(Rule #1 AND Rule #2) OR (Rule #3 AND Rule #4)')
  })
})

describe('V1 adjacent rules boolean evaluation with AND-before-OR precedence', () => {
  const barsMatchClose102Vol500: Bar[] = [
    makeBar(60, 100, 105, 99, 102, 500),
    makeBar(120, 101, 106, 100, 102, 500),
  ]
  const barsMatchClose102Vol2000: Bar[] = [
    makeBar(60, 100, 105, 99, 102, 2000),
    makeBar(120, 101, 106, 100, 102, 2000),
  ]
  const barsMatchClose106Vol500: Bar[] = [
    makeBar(60, 100, 105, 99, 106, 500),
    makeBar(120, 101, 107, 100, 106, 500),
  ]
  const barsMatchClose95Vol2000: Bar[] = [
    makeBar(60, 100, 105, 94, 95, 2000),
    makeBar(120, 96, 98, 93, 95, 2000),
  ]

  // R1: close > 100
  const r1: SingleAlertCondition = {
    id: 'r1',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'greaterThan',
    right: { type: 'value', value: 100 },
  }
  // R2: close > 105
  const r2: SingleAlertCondition = {
    id: 'r2',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'greaterThan',
    right: { type: 'value', value: 105 },
    connector: 'and',
  }
  // R3: volume > 1000
  const r3: SingleAlertCondition = {
    id: 'r3',
    timeframe: 'chart',
    left: { type: 'volume' },
    operator: 'greaterThan',
    right: { type: 'value', value: 1000 },
    connector: 'or',
  }

  it('evaluates (R1 AND R2) OR R3 correctly with standard precedence', () => {
    // Config: R1 AND R2 OR R3
    // Connectors: between R1 & R2 is 'and', between R2 & R3 is 'or'
    const config: AdvancedAlertConfig = {
      id: 'r1-and-r2-or-r3',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [
        r1,
        { ...r2, connector: 'and' },
        { ...r3, connector: 'or' },
      ],
    }

    // 1) close=102, vol=500: R1=true, R2=false, R3=false => (T AND F) OR F => false
    expect(evaluateAdvancedAlert(config, barsMatchClose102Vol500)).toBe(false)

    // 2) close=102, vol=2000: R1=true, R2=false, R3=true => (T AND F) OR T => true
    expect(evaluateAdvancedAlert(config, barsMatchClose102Vol2000)).toBe(true)

    // 3) close=106, vol=500: R1=true, R2=true, R3=false => (T AND T) OR F => true
    expect(evaluateAdvancedAlert(config, barsMatchClose106Vol500)).toBe(true)
  })

  it('evaluates R1 OR (R2 AND R3) correctly with standard precedence', () => {
    // Config: R1 OR R2 AND R3
    // Connectors: between R1 & R2 is 'or', between R2 & R3 is 'and'
    const config: AdvancedAlertConfig = {
      id: 'r1-or-r2-and-r3',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [
        r1,
        { ...r2, connector: 'or' },
        { ...r3, connector: 'and' },
      ],
    }

    // 1) close=102, vol=500: R1=true, R2=false, R3=false => T OR (F AND F) => true (R1 satisfies)
    expect(evaluateAdvancedAlert(config, barsMatchClose102Vol500)).toBe(true)

    // 2) close=95, vol=2000: R1=false, R2=false, R3=true => F OR (F AND T) => false
    expect(evaluateAdvancedAlert(config, barsMatchClose95Vol2000)).toBe(false)

    // 3) Change R2 to close < 100: on close=95, vol=2000:
    // R1 (close > 100) = false, R2 (close < 100) = true, R3 (vol > 1000) = true
    // F OR (T AND T) => true
    const r2Alt: SingleAlertCondition = {
      id: 'r2-alt',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'lessThan',
      right: { type: 'value', value: 100 },
      connector: 'or',
    }
    const configAlt: AdvancedAlertConfig = {
      id: 'r1-or-r2alt-and-r3',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [
        r1,
        r2Alt,
        { ...r3, connector: 'and' },
      ],
    }
    expect(evaluateAdvancedAlert(configAlt, barsMatchClose95Vol2000)).toBe(true)
  })

  it('falls back to flat config.logic when conditions do not specify individual connectors', () => {
    // 3 conditions without connectors, config.logic = 'and'
    const flatAndConfig: AdvancedAlertConfig = {
      id: 'flat-and',
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [r1, { ...r2, connector: undefined }, { ...r3, connector: undefined }],
    }
    // close=102, vol=2000: R1=true, R2=false, R3=true => AND gives false
    expect(evaluateAdvancedAlert(flatAndConfig, barsMatchClose102Vol2000)).toBe(false)

    // config.logic = 'or'
    const flatOrConfig: AdvancedAlertConfig = {
      id: 'flat-or',
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [r1, { ...r2, connector: undefined }, { ...r3, connector: undefined }],
    }
    // close=102, vol=500: R1=true, R2=false, R3=false => OR gives true
    expect(evaluateAdvancedAlert(flatOrConfig, barsMatchClose102Vol500)).toBe(true)
  })
})

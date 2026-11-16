import type { AlertController, Bar, Chart, SeriesApi } from 'openalgo-charts'
import type { DrawingController } from 'openalgo-charts/draw'
import 'openalgo-charts/indicators'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  type AdvancedAlertConfig,
  registerAdvancedAlertCondition,
  unregisterAdvancedAlertCondition,
} from './advancedAlerts'
import { type AlertChart, type AlertDraft, toAlertInput } from './alertsModel'
import { type SymbolView, TradingTerminal } from './terminal'

type State = {
  chart: Chart
  price: SeriesApi
  draw: DrawingController
  alerts: AlertController
  chartToolsReady: Promise<void>
  sym: SymbolView
  interval: string
  rawBars: Bar[]
  ctype: string
  volume: SeriesApi
  buildChart(): void
  loadIndicators(): Promise<void>
  syncIndicators(): void
}

const bar = (
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

const terminals: TradingTerminal[] = []

beforeEach(() => {
  vi.useFakeTimers()
  localStorage.clear()
  const context = new Proxy(
    {
      measureText: (text: string) => ({ width: text.length * 7 }),
      createLinearGradient: () => ({ addColorStop() {} }),
      getImageData: () => ({ data: new Uint8ClampedArray([0, 0, 0, 255]) }),
    },
    { get: (target, key) => target[key as keyof typeof target] ?? (() => {}) }
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(
    context as unknown as CanvasRenderingContext2D
  )
})

afterEach(() => {
  for (const terminal of terminals.splice(0)) terminal.destroy()
  vi.clearAllTimers()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

async function mount() {
  const onToast = vi.fn()
  const onAlertFired = vi.fn()
  const terminal = new TradingTerminal({
    apiKey: 'test',
    wsUrl: 'ws://test.invalid',
    container: document.createElement('div'),
    legendEl: document.createElement('div'),
    getTheme: () => ({ mode: 'dark', appMode: 'live' }),
    callbacks: {
      onReady() {},
      onToast,
      onContextMenu() {},
      onWsState() {},
      onSymbolLoaded() {},
      onLtp() {},
      onAlertFired,
    },
  })
  terminals.push(terminal)
  const state = terminal as unknown as State
  state.loadIndicators = async () => {}
  state.sym = {
    symbol: 'NIFTY29SEP26FUT',
    exchange: 'NFO',
    name: 'Nifty Futures',
    lotsize: 65,
    lots: true,
    tick: 0.05,
    freezeQty: 1800,
    quoteOnly: false,
    productOptions: ['MIS', 'NRML'],
    product: 'MIS',
  }
  state.interval = '1m'
  state.rawBars = [
    bar(60, 100, 102, 98, 100, 500),
    bar(120, 100, 103, 99, 101, 500),
    bar(180, 101, 104, 100, 102, 500),
    bar(240, 102, 104, 101, 102, 500),
  ]
  state.buildChart()
  await state.chartToolsReady
  return { terminal, state, onToast, onAlertFired }
}

describe('Chart Engine OHLC & Trigger Compatibility Audit', () => {
  it('evaluates High intrabar condition under onTouch policy', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-high-ontouch'

    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-high',
          timeframe: 'chart',
          left: { type: 'price', source: 'high' },
          operator: 'greaterThan',
          right: { type: 'value', value: 105 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-high-touch',
      title: 'High Breakout',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'once',
    })

    // Tick 1: high = 104 <= 105, should not fire
    state.price.update(bar(240, 102, 104, 101, 103, 600))
    expect(onToast).not.toHaveBeenCalled()

    // Tick 2: high spiked to 107 > 105 (intrabar touch!), should fire immediately
    state.price.update(bar(240, 102, 107, 101, 103, 700))
    expect(onToast).toHaveBeenCalledWith('High Breakout', 'ok')

    // Subsequent tick on same bar: repeat is 'once', should NOT fire again
    onToast.mockClear()
    state.price.update(bar(240, 102, 108, 101, 103, 800))
    expect(onToast).not.toHaveBeenCalled()

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates Low intrabar condition under onTouch policy', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-low-ontouch'

    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-low',
          timeframe: 'chart',
          left: { type: 'price', source: 'low' },
          operator: 'lessThan',
          right: { type: 'value', value: 95 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-low-touch',
      title: 'Low Breakdown',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'once',
    })

    // Tick 1: low = 98 >= 95, no fire
    state.price.update(bar(240, 102, 104, 98, 100, 600))
    expect(onToast).not.toHaveBeenCalled()

    // Tick 2: low dips to 93 < 95 (even if close is 99!), fires immediately
    state.price.update(bar(240, 102, 104, 93, 99, 700))
    expect(onToast).toHaveBeenCalledWith('Low Breakdown', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates HL2 and HLC3 price sources correctly', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-hl2-hlc3'

    // HL2 = (high + low)/2. For bar with high=110, low=90 => HL2 = 100.
    // HLC3 = (high + low + close)/3. For high=110, low=90, close=106 => HLC3 = 306/3 = 102.
    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-hlc3',
          timeframe: 'chart',
          left: { type: 'price', source: 'hlc3' },
          operator: 'greaterThan',
          right: { type: 'value', value: 101 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-hlc3',
      title: 'HLC3 Above 101',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'once',
    })

    // Tick 1: high=102, low=98, close=100 => HLC3 = 100 <= 101 => no fire
    state.price.update(bar(240, 100, 102, 98, 100, 500))
    expect(onToast).not.toHaveBeenCalled()

    // Tick 2: high=110, low=90, close=106 => HLC3 = 102 > 101 => fires!
    state.price.update(bar(240, 100, 110, 90, 106, 600))
    expect(onToast).toHaveBeenCalledWith('HLC3 Above 101', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates onBarClose policy only after candle is confirmed, avoiding lookahead & repainting', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-onbarclose'

    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-close-confirm',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 105 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-on-close',
      title: 'Confirmed Close',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onBarClose',
      repeat: 'once',
    })

    // Intrabar tick at time 240: close is 110 > 105, but candle is NOT closed yet!
    state.price.update(bar(240, 102, 110, 101, 110, 500))
    // MUST NOT fire while candle is forming under onBarClose policy
    expect(onToast).not.toHaveBeenCalled()

    // Next candle arrives at time 300, confirming candle 240 with close=110 > 105
    state.price.update(bar(300, 110, 112, 109, 111, 500))
    // NOW it fires on the confirmed closed candle!
    expect(onToast).toHaveBeenCalledWith('Confirmed Close', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates crossovers without false triggers when condition was already satisfied', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-crossover'

    // Condition: close crosses up 105.
    // Base bars: 60 (100), 120 (101), 180 (102), 240 (102).
    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'c-cross',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'crossingUp',
          right: { type: 'value', value: 105 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-cross',
      title: 'Crossed Up',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'everyTime',
      cooldownSeconds: 0,
    })

    // Bar 240 has close = 102 (<= 105).
    // Now bar 300 moves to close = 106 (> 105) -> TRUE CROSSOVER!
    state.price.update(bar(300, 102, 106, 102, 106, 500))
    expect(onToast).toHaveBeenCalledWith('Crossed Up', 'ok')

    // Next bar 360 has close = 107 (> 105).
    // Prior bar 300 was 106 (> 105). It was ALREADY above 105!
    // Must NOT fire another crossover because it did not cross on this bar!
    onToast.mockClear()
    state.price.update(bar(360, 106, 108, 106, 107, 500))
    expect(onToast).not.toHaveBeenCalled()

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates simplified 3-rule AND/OR combinations in the chart engine', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-3rule-combo'

    // Formula: (Rule 1: High > 110 AND Rule 2: Volume > 1000) OR Rule 3: Close < 90
    // Standard precedence: (R1 AND R2) OR R3
    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'or',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'r1',
          timeframe: 'chart',
          left: { type: 'price', source: 'high' },
          operator: 'greaterThan',
          right: { type: 'value', value: 110 },
        },
        {
          id: 'r2',
          timeframe: 'chart',
          left: { type: 'volume' },
          operator: 'greaterThan',
          right: { type: 'value', value: 1000 },
          connector: 'and',
        },
        {
          id: 'r3',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'lessThan',
          right: { type: 'value', value: 90 },
          connector: 'or',
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-3rule',
      title: '3-Rule Combo',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'everyTime',
      cooldownSeconds: 0,
    })

    // Case 1: High = 112 (>110, R1=true), Volume = 500 (<=1000, R2=false), Close = 100 (>=90, R3=false)
    // (T AND F) OR F = FALSE. Should not fire!
    state.price.update(bar(240, 100, 112, 98, 100, 500))
    expect(onToast).not.toHaveBeenCalled()

    // Case 2: High = 112 (>110, R1=true), Volume = 1500 (>1000, R2=true), Close = 100 (R3=false)
    // (T AND T) OR F = TRUE. Should fire!
    state.price.update(bar(240, 100, 112, 98, 100, 1500))
    expect(onToast).toHaveBeenCalledWith('3-Rule Combo', 'ok')

    // Case 3: High = 102 (R1=false), Volume = 200 (R2=false), Close = 85 (<90, R3=true)
    // (F AND F) OR T = TRUE. Should fire via R3 branch!
    onToast.mockClear()
    state.price.update(bar(300, 95, 96, 84, 85, 200))
    expect(onToast).toHaveBeenCalledWith('3-Rule Combo', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('respects cooldown and repeat settings in the chart engine', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-cooldown'

    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'everyTime',
      conditions: [
        {
          id: 'c-high',
          timeframe: 'chart',
          left: { type: 'price', source: 'high' },
          operator: 'greaterThan',
          right: { type: 'value', value: 105 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-cooldown',
      title: 'Cooldown Alert',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'everyTime',
      cooldownSeconds: 60, // 60 seconds cooldown
    })

    // First trigger: high = 108 > 105 -> fires
    state.price.update(bar(240, 100, 108, 99, 102, 500))
    expect(onToast).toHaveBeenCalledWith('Cooldown Alert', 'ok')

    // Immediate second tick within cooldown: high = 110 > 105 -> suppressed by cooldown!
    onToast.mockClear()
    state.price.update(bar(240, 100, 110, 99, 103, 500))
    expect(onToast).not.toHaveBeenCalled()

    // Advance clock past 60s cooldown (e.g. 65s)
    vi.advanceTimersByTime(65_000)

    // Third tick at time 305 after cooldown elapsed: high = 112 > 105 -> fires again!
    state.price.update(bar(305, 100, 112, 99, 104, 500))
    expect(onToast).toHaveBeenCalledWith('Cooldown Alert', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates Open price source correctly and distinguishes it from High/Low/Close', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-open-source'

    // Condition: Open > 105.
    // If a bar has open=100, high=110, close=110, low=99 -> open is 100 <= 105 => FALSE
    // If a bar has open=106, high=107, close=100, low=99 -> open is 106 > 105 => TRUE
    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-open',
          timeframe: 'chart',
          left: { type: 'price', source: 'open' },
          operator: 'greaterThan',
          right: { type: 'value', value: 105 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    state.alerts.add({
      id: 'alert-open',
      title: 'Open Above 105',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'once',
    })

    // Tick 1: open = 100 <= 105 (even though high=115, close=115!) -> must NOT fire
    state.price.update(bar(240, 100, 115, 99, 115, 500))
    expect(onToast).not.toHaveBeenCalled()

    // Tick 2 on new bar 300: open = 106 > 105 (even though close falls to 101!) -> FIRES
    state.price.update(bar(300, 106, 107, 100, 101, 500))
    expect(onToast).toHaveBeenCalledWith('Open Above 105', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('evaluates multi-timeframe condition against resampled bars accurately', async () => {
    const { state, onToast } = await mount()
    const configId = 'test-mtf-resample'

    // Condition on 5m timeframe: volume > 1200
    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-5m-vol',
          timeframe: '5m',
          left: { type: 'volume' },
          operator: 'greaterThan',
          right: { type: 'value', value: 1200 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    const host = state as unknown as { rawBars: Bar[]; setPriceData(): void }
    host.rawBars = [
      bar(60, 100, 102, 98, 100, 500),
      bar(120, 100, 103, 99, 101, 500),
      bar(180, 101, 104, 100, 102, 500),
      bar(240, 102, 104, 101, 102, 500),
      bar(300, 102, 104, 101, 102, 500),
    ]
    host.setPriceData()

    state.alerts.add({
      id: 'alert-5m-vol',
      title: '5M Volume Spike',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'once',
    })

    // Update bar at 360 with volume 1000 => 5m bucket 300 has 500 + 1000 = 1500 > 1200
    state.price.update(bar(360, 102, 104, 101, 102, 1000))
    expect(onToast).toHaveBeenCalledWith('5M Volume Spike', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  it('preserves advanced alert through serialization toJSON and restoration fromJSON', async () => {
    const a = await mount()
    const configId = 'test-serialize'

    const config: AdvancedAlertConfig = {
      id: configId,
      logic: 'and',
      triggerMode: 'once',
      conditions: [
        {
          id: 'c-high',
          timeframe: 'chart',
          left: { type: 'price', source: 'high' },
          operator: 'greaterThan',
          right: { type: 'value', value: 110 },
        },
      ],
    }

    const condId = registerAdvancedAlertCondition(config)
    a.state.alerts.add({
      id: 'saved-alert',
      title: 'Saved Breakout',
      source: { kind: 'barCondition', id: condId },
      condition: 'matches',
      policy: 'onTouch',
      repeat: 'once',
      payload: { advancedConfig: config },
    })

    // Serialize workspace alerts
    const serialized = a.state.alerts.toJSON()
    expect(serialized.alerts.length).toBeGreaterThan(0)
    expect(serialized.alerts[0].title).toBe('Saved Breakout')

    a.terminal.destroy()

    // Restore in a fresh terminal instance
    const b = await mount()
    b.state.alerts.fromJSON(serialized)

    // Verify alert is loaded in 'armed' state
    const restored = b.state.alerts.list().find((item) => item.id === 'saved-alert')
    expect(restored).toBeDefined()
    expect(restored?.state).toBe('armed')

    // Feed a tick exceeding threshold: should trigger restored alert
    b.state.price.update(bar(240, 100, 115, 99, 103, 500))
    expect(b.onToast).toHaveBeenCalledWith('Saved Breakout', 'ok')

    unregisterAdvancedAlertCondition(configId)
  })

  describe('Timeframe Synchronization & Availability (1m bug regression)', () => {
    it('creates fresh 1m multi-condition alert on 1m chart without timeframe-switch warning', async () => {
      const { terminal, state, onToast } = await mount()
      const draft: AlertDraft = {
        kind: 'advanced',
        title: 'NIFTY 1m Double Condition',
        sourceId: 'price',
        conditionId: 'crossingUp',
        targetValue: 105,
        policy: 'onTouch',
        repeat: 'once',
        enabled: true,
        deliver: { sound: false, notify: false },
        exchange: 'NSE',
        advancedConditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'high' },
            operator: 'greaterThan',
            right: { type: 'value', value: 105 },
          },
          {
            id: 'c2',
            timeframe: '1m',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
        ],
        advancedLogic: 'and',
        cooldownSeconds: '',
        expiresAt: '',
        message: '',
        value: '105',
        upperValue: '',
        instanceId: '',
        plotKey: '',
        drawingId: '',
        level: '',
        barConditionId: '',
      }

      const input = toAlertInput(
        draft,
        state.chart as unknown as AlertChart,
        null,
        state.sym.symbol,
        undefined,
        terminal.interval,
        state.sym.exchange
      )
      expect(input).not.toBeNull()
      expect(input?.scope?.interval).toBe('1m')

      const created = state.alerts.add(input!)
      if (input?.scope && created?.id) {
        state.alerts.update(created.id, { scope: input.scope })
      }

      const alert = state.alerts.list().find((a) => a.id === created.id)
      expect(alert).toBeDefined()
      expect(alert?.scope?.interval).toBe('1m')

      const avail = state.alerts.availability(created.id)
      expect(avail.available).toBe(true)
      expect(avail.reason).toBeUndefined()

      // Trigger on 1m tick
      state.price.update(bar(240, 100, 108, 99, 106, 500))
      expect(onToast).toHaveBeenCalledWith('NIFTY 1m Double Condition', 'ok')
    })

    it('updates existing 5m alert to 1m when rules are changed, removing timeframe mismatch warning', async () => {
      const { terminal, state, onToast } = await mount()
      // Chart is 1m. Suppose an alert was saved with 5m scope on this instrument.
      const created = state.alerts.add({
        id: 'existing-5m-alert',
        title: 'Existing 5m Alert',
        source: { kind: 'barCondition', id: 'some-cond' },
        condition: 'matches',
        policy: 'onTouch',
        repeat: 'once',
      })
      // Force scope to 5m to simulate an alert created or saved on 5m
      state.alerts.update(created.id, {
        scope: { symbol: state.sym.symbol, exchange: state.sym.exchange, interval: '5m' },
      })

      // On 1m chart, availability must report mismatch
      const availBefore = state.alerts.availability(created.id)
      expect(availBefore.available).toBe(false)
      expect(availBefore.reason).toContain('Switch to 5m to evaluate this alert')

      // Now edit alert: user sets rules to 1m
      const editDraft: AlertDraft = {
        kind: 'advanced',
        title: 'Updated to 1m',
        sourceId: 'price',
        conditionId: 'crossingUp',
        targetValue: 110,
        policy: 'onTouch',
        repeat: 'once',
        enabled: true,
        deliver: { sound: false, notify: false },
        exchange: state.sym.exchange,
        advancedConditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'high' },
            operator: 'greaterThan',
            right: { type: 'value', value: 110 },
          },
        ],
        advancedLogic: 'and',
        cooldownSeconds: '',
        expiresAt: '',
        message: '',
        value: '110',
        upperValue: '',
        instanceId: '',
        plotKey: '',
        drawingId: '',
        level: '',
        barConditionId: '',
      }

      const editInput = toAlertInput(
        editDraft,
        state.chart as unknown as AlertChart,
        null,
        state.sym.symbol,
        undefined,
        terminal.interval,
        state.sym.exchange
      )
      expect(editInput?.scope?.interval).toBe('1m')

      state.alerts.update(created.id, editInput!)

      // Warning should disappear and alert becomes available on 1m chart
      const availAfter = state.alerts.availability(created.id)
      expect(availAfter.available).toBe(true)
      expect(availAfter.reason).toBeUndefined()

      // Evaluation works
      state.price.update(bar(240, 100, 112, 99, 103, 500))
      expect(onToast).toHaveBeenCalledWith('Updated to 1m', 'ok')
    })

    it('handles chart timeframe switching correctly: active on 1m, warning on 15m, active again on 1m', async () => {
      const { terminal, state } = await mount()
      const condId = registerAdvancedAlertCondition({
        id: 'adv_test_tf_switch',
        logic: 'and',
        triggerMode: 'once',
        conditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'high' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
        ],
      })
      const created = state.alerts.add({
        id: 'tf-switch-alert',
        title: '1m Alert',
        source: { kind: 'barCondition', id: condId },
        condition: 'matches',
        policy: 'onTouch',
        repeat: 'once',
      })
      state.alerts.update(created.id, {
        scope: { symbol: state.sym.symbol, exchange: state.sym.exchange, interval: '1m' },
      })

      expect(state.alerts.availability(created.id).available).toBe(true)

      // Switch chart to 15m
      terminal.setInterval('15m')
      expect(state.chart.getDataContext().interval).toBe('15m')

      const avail15m = state.alerts.availability(created.id)
      expect(avail15m.available).toBe(false)
      expect(avail15m.reason).toContain('Switch to 1m to evaluate this alert')

      // Switch chart back to 1m
      terminal.setInterval('1m')
      expect(state.chart.getDataContext().interval).toBe('1m')

      const avail1m = state.alerts.availability(created.id)
      expect(avail1m.available).toBe(true)
      expect(avail1m.reason).toBeUndefined()

      unregisterAdvancedAlertCondition('adv_test_tf_switch')
    })

    it('ensures explicit 1m rules enforce 1m scope even if chart context was temporarily on 5m', async () => {
      const { state } = await mount()
      // Temporarily set chart context to 5m
      state.chart.setDataContext({ symbol: 'NIFTY', exchange: 'NSE', interval: '5m' })

      const draft: AlertDraft = {
        kind: 'advanced',
        title: 'Explicit 1m Alert',
        sourceId: 'price',
        conditionId: 'crossingUp',
        targetValue: 100,
        policy: 'onTouch',
        repeat: 'once',
        enabled: true,
        deliver: { sound: false, notify: false },
        exchange: 'NSE',
        advancedConditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'high' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
          {
            id: 'c2',
            timeframe: '1m',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 95 },
          },
        ],
        advancedLogic: 'and',
        cooldownSeconds: '',
        expiresAt: '',
        message: '',
        value: '100',
        upperValue: '',
        instanceId: '',
        plotKey: '',
        drawingId: '',
        level: '',
        barConditionId: '',
      }

      // toAlertInput resolves to '1m' despite chart being 5m
      const input = toAlertInput(
        draft,
        state.chart as unknown as AlertChart,
        null,
        'NIFTY',
        undefined,
        '5m',
        'NSE'
      )
      expect(input?.scope?.interval).toBe('1m')

      // AlertsDialog add + update pattern
      const created = state.alerts.add(input!)
      // add(input) initially forces chart's 5m scope
      expect(state.alerts.list().find((a) => a.id === created.id)?.scope?.interval).toBe('5m')

      // But immediate update syncs it to target 1m scope
      if (input?.scope && created?.id) {
        state.alerts.update(created.id, { scope: input.scope })
      }
      expect(state.alerts.list().find((a) => a.id === created.id)?.scope?.interval).toBe('1m')
    })
  })
})

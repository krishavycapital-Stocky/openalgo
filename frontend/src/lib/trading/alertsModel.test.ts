/**
 * The part of the alert dialog that is not React.
 *
 * Two things here are worth more than the rest.
 *
 * A draft that will not save has to say why in a sentence somebody can act on.
 * The engine refuses in terms of its own contract, which is correct and useless
 * to a trader who left a box empty, and the dialog's Save is disabled off the
 * back of these answers: a rule that returns null when it should not gives you
 * an enabled button that does nothing.
 *
 * And the expiry is on the chart's clock. An alert is set against candles the
 * chart has already labelled in its zone, so reading the field in another one
 * is hours out. On this deployment's zone that error is five and a half hours,
 * which is enough to expire an alert before the session it was set for.
 */

import { describe, expect, it } from 'vitest'
import { DEFAULT_DELIVERY, deliveryOf } from './alertDelivery'
import {
  type AlertChart,
  type AlertDraft,
  type AlertDrawings,
  alertTitleFor,
  DEFAULT_EXPIRY_MONTHS,
  defaultExpiry,
  draftFor,
  draftProblem,
  expirySeconds,
  expiryText,
  hasAutoTitle,
  isRangeCondition,
  lastClose,
  needsThreshold,
  plotChoices,
  plotValueAt,
  resolveAlertInterval,
  snapPrice,
  studyChoices,
  titleFor,
  toAlertInput,
} from './alertsModel'

const ZONE = 'Asia/Kolkata'

function chart(overrides: Partial<AlertChart> = {}): AlertChart {
  return {
    indicators: () => [
      {
        id: 'i1',
        name: 'Supertrend',
        indicatorId: 'openscript:supertrend',
        paneIndex: 0,
        values: () => ({ band: [10, 11, 12], dir: [-1, -1, 1] }),
        series: (key: string) => (key === 'band' || key === 'dir' ? {} : undefined),
      },
    ],
    primaryBars: () => [{ close: 100 }, { close: 101 }, { close: 102.5 }],
    timezone: () => ZONE,
    ...overrides,
  }
}

const drawings: AlertDrawings = {
  drawings: () => [{ id: 'd1', tool: 'trend-line' }],
  alertInfo: () => ({ available: true, levels: [{ id: 'line', title: 'Line' }] }),
}

function draft(overrides: Partial<AlertDraft> = {}): AlertDraft {
  return {
    kind: 'price',
    condition: 'crossing',
    value: '1243.4',
    upperValue: '',
    instanceId: 'i1',
    plotKey: 'band',
    drawingId: 'd1',
    level: 'line',
    barConditionId: 'inside-bar',
    policy: 'onBarClose',
    repeat: 'once',
    cooldownSeconds: '0',
    expiresAt: '',
    title: '',
    message: '',
    enabled: true,
    ...overrides,
  }
}

describe('what the dialog can offer to watch', () => {
  it('numbers the studies the way the legend does', () => {
    expect(studyChoices(chart())).toEqual([{ value: 'i1', label: '1: Supertrend' }])
  })

  it('reads a study plots from the live instance', () => {
    // From the instance rather than the registry, so a study whose plots depend
    // on its settings offers what it is actually drawing right now.
    expect(plotChoices(chart(), 'i1').map((one) => one.value)).toEqual(['band', 'dir'])
    expect(plotChoices(chart(), 'gone')).toEqual([])
  })

  it('seeds a threshold from the last value there is, not the last slot', () => {
    // A study warming up has nulls at the tail. Seeding from the final slot
    // gives an empty box on exactly the studies that need one most.
    const warming = chart({
      indicators: () => [
        {
          id: 'i1',
          name: 'S',
          indicatorId: 's',
          paneIndex: 0,
          values: () => ({ band: [10, 11, null] }),
          series: () => ({}),
        },
      ],
    })
    expect(plotValueAt(warming, 'i1', 'band')).toBe(11)
    expect(plotValueAt(warming, 'i1', 'missing')).toBeNull()
    expect(lastClose(chart())).toBe(102.5)
  })
})

describe('which controls a source needs', () => {
  it('asks for a number only where a number means something', () => {
    // A trend line is already at a price on every bar and a candle condition is
    // either true or not, so a threshold beside either is a number with nothing
    // to compare against.
    expect(needsThreshold('price')).toBe(true)
    expect(needsThreshold('indicator')).toBe(true)
    expect(needsThreshold('drawing')).toBe(false)
    expect(needsThreshold('barCondition')).toBe(false)
  })

  it('knows which conditions need a second bound', () => {
    expect(isRangeCondition('enteringRange')).toBe(true)
    expect(isRangeCondition('leavingRange')).toBe(true)
    expect(isRangeCondition('crossing')).toBe(false)
  })
})

describe('why a draft will not save', () => {
  it('accepts the ordinary one', () => {
    expect(draftProblem(draft(), chart(), drawings)).toBeNull()
  })

  it('names an empty threshold in the words of the thing being watched', () => {
    expect(draftProblem(draft({ value: '' }), chart(), drawings)).toBe('Enter a price to watch.')
    expect(draftProblem(draft({ kind: 'indicator', value: '' }), chart(), drawings)).toBe(
      'Enter a value to watch.'
    )
    expect(draftProblem(draft({ value: 'abc' }), chart(), drawings)).toBe('Enter a price to watch.')
  })

  it('refuses a channel with one bound, or with two of the same', () => {
    const range = { condition: 'enteringRange' as const, value: '100' }
    expect(draftProblem(draft({ ...range, upperValue: '' }), chart(), drawings)).toBe(
      'A channel needs both of its bounds.'
    )
    // Two identical bounds is a channel of zero width: it can be entered and
    // left on the same tick, and the engine would arm it happily.
    expect(draftProblem(draft({ ...range, upperValue: '100' }), chart(), drawings)).toBe(
      'A channel needs two different bounds.'
    )
    expect(draftProblem(draft({ ...range, upperValue: '110' }), chart(), drawings)).toBeNull()
  })

  it('refuses a study or plot that is not there', () => {
    const study = { kind: 'indicator' as const, value: '11' }
    expect(draftProblem(draft({ ...study, instanceId: 'gone' }), chart(), drawings)).toMatch(
      /Choose a study/
    )
    expect(draftProblem(draft({ ...study, plotKey: 'gone' }), chart(), drawings)).toBe(
      'Choose a plot from that study.'
    )
  })

  it('refuses a drawing alert before anything is drawn', () => {
    // The common first encounter: open the dialog, choose Drawing level, and
    // there is nothing on the chart. A silent empty select teaches nothing.
    const none: AlertDrawings = {
      drawings: () => [],
      alertInfo: () => ({ available: false, levels: [] }),
    }
    expect(draftProblem(draft({ kind: 'drawing', drawingId: '' }), chart(), none)).toMatch(
      /Draw something on the chart first/
    )
    expect(draftProblem(draft({ kind: 'drawing' }), chart(), null)).toMatch(/still loading/)
  })

  it('accepts a blank cooldown but not a nonsense one', () => {
    expect(draftProblem(draft({ cooldownSeconds: '' }), chart(), drawings)).toBeNull()
    expect(draftProblem(draft({ cooldownSeconds: '-5' }), chart(), drawings)).toMatch(/cooldown/)
  })
})

describe('the expiry is on the chart clock', () => {
  it('round-trips a reading through the chart zone', () => {
    const text = '2026-11-21T18:30'
    const seconds = expirySeconds(text, ZONE)
    expect(seconds).toBeDefined()
    expect(expiryText(seconds, ZONE)).toBe(text)
  })

  it('is not the same instant as the same reading in UTC', () => {
    // The whole point. On this zone the two are five and a half hours apart,
    // and a test that only round-trips would pass against a UTC reading too.
    const text = '2026-11-21T18:30'
    const asUtc = Date.parse(`${text}:00Z`) / 1000
    expect(expirySeconds(text, ZONE)).toBe(asUtc - 5.5 * 3600)
  })

  it('reads nothing as no expiry rather than as the epoch', () => {
    expect(expirySeconds('', ZONE)).toBeUndefined()
    expect(expirySeconds('not a date', ZONE)).toBeUndefined()
    expect(expiryText(undefined, ZONE)).toBe('')
  })

  it('opens a new alert two months out, on that clock', () => {
    const now = new Date('2026-09-21T10:00:00Z')
    const text = defaultExpiry(ZONE, now)
    const seconds = expirySeconds(text, ZONE)!
    const days = (seconds - now.getTime() / 1000) / 86400
    // Two calendar months is 59 to 62 days whichever month it starts in.
    expect(days).toBeGreaterThan(58)
    expect(days).toBeLessThan(63)
    expect(DEFAULT_EXPIRY_MONTHS).toBe(2)
  })

  it('lands on a date that exists when the month is longer than the next', () => {
    // The 31st of December plus two months is not the 31st of February. Adding
    // days would drift; the calendar knows.
    const text = defaultExpiry(ZONE, new Date('2026-12-31T10:00:00Z'))
    expect(text).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/)
    expect(expirySeconds(text, ZONE)).toBeDefined()
  })
})

describe('what the alert ends up called', () => {
  it('reads as the sentence it means', () => {
    // The engine's own default is "Chart alert", and a list of six of those
    // says nothing about any of them.
    expect(titleFor(draft(), chart(), 'RELIANCE')).toBe('RELIANCE crossing 1243.4')
    expect(
      titleFor(draft({ condition: 'enteringRange', upperValue: '1300' }), chart(), 'RELIANCE')
    ).toBe('RELIANCE entering channel 1243.4 and 1300')
    expect(titleFor(draft({ kind: 'indicator' }), chart(), 'RELIANCE')).toBe(
      'Supertrend crossing 1243.4'
    )
  })
})

describe('the draft as the engine takes it', () => {
  it('builds a price source, and keeps what the trader typed', () => {
    const input = toAlertInput(draft({ message: 'Ping me' }), chart(), drawings, 'RELIANCE')
    expect(input).toMatchObject({
      source: { kind: 'price', price: 1243.4 },
      condition: 'crossing',
      policy: 'onBarClose',
      repeat: 'once',
      state: 'armed',
      title: 'RELIANCE crossing 1243.4',
      message: 'Ping me',
      cooldownSeconds: 0,
    })
    expect(input?.expiresAt).toBeUndefined()
  })

  it('carries the second bound only for a channel', () => {
    const plain = toAlertInput(draft({ upperValue: '1300' }), chart(), drawings, 'R')
    expect(plain?.source).not.toHaveProperty('upperPrice')
    const range = toAlertInput(
      draft({ condition: 'enteringRange', upperValue: '1300' }),
      chart(),
      drawings,
      'R'
    )
    expect(range?.source).toMatchObject({ price: 1243.4, upperPrice: 1300 })
  })

  it('builds the other three sources from their own fields', () => {
    expect(
      toAlertInput(draft({ kind: 'indicator' }), chart(), drawings, 'R')?.source
    ).toMatchObject({
      kind: 'indicator',
      instanceId: 'i1',
      plotKey: 'band',
    })
    expect(toAlertInput(draft({ kind: 'drawing' }), chart(), drawings, 'R')?.source).toMatchObject({
      kind: 'drawing',
      drawingId: 'd1',
      level: 'line',
    })
    expect(
      toAlertInput(draft({ kind: 'barCondition' }), chart(), drawings, 'R')?.source
    ).toMatchObject({ kind: 'barCondition', id: 'inside-bar' })
  })

  it('refuses a draft it cannot build rather than building a broken one', () => {
    // Null, not a throw: `draftProblem` is what says why, in a trader's words,
    // and a caller that has already asked should not have to catch to find out
    // the same thing in the engine's.
    expect(toAlertInput(draft({ value: '' }), chart(), drawings, 'R')).toBeNull()
  })

  it('disables rather than arms when the switch is off', () => {
    expect(toAlertInput(draft({ enabled: false }), chart(), drawings, 'R')?.state).toBe('disabled')
  })

  it('marks a name it wrote itself, so a drag may rewrite it', () => {
    const generated = toAlertInput(draft({ title: '   ' }), chart(), drawings, 'R')
    expect(hasAutoTitle({ ...generated, payload: generated?.payload } as never)).toBe(true)
  })

  it('leaves a name the trader typed unmarked, so nothing rewrites it', () => {
    // Their words, and a drag moving the price is no reason to take them away.
    // The payload itself is not empty: it carries how they asked to be told.
    const typed = toAlertInput(draft({ title: 'Cover the short' }), chart(), drawings, 'R')
    expect(hasAutoTitle({ ...typed, payload: typed?.payload } as never)).toBe(false)
    expect(deliveryOf(typed?.payload)).toEqual(DEFAULT_DELIVERY)
  })

  it('sends no message at all rather than an empty one', () => {
    expect(toAlertInput(draft({ message: '   ' }), chart(), drawings, 'R')?.message).toBeUndefined()
  })
})

describe('a stored price sits on the instrument tick', () => {
  const at = { tick: 0.05, refPrice: 1293 }

  it('snaps the price a pixel produced', () => {
    // The reported case, exactly: right-clicking at 1,293.63 armed an alert at
    // 1293.6305656934308. A pixel maps to a price with fifteen decimals behind
    // it, and no instrument trades at that.
    expect(snapPrice(1293.6305656934308, at)).toBe(1293.65)
    expect(snapPrice(1293.61, at)).toBe(1293.6)
  })

  it('snaps what is saved, not only what is shown', () => {
    const input = toAlertInput(
      draft({ value: '1293.6305656934308' }),
      chart(),
      drawings,
      'RELIANCE',
      at
    )
    expect(input?.source).toMatchObject({ kind: 'price', price: 1293.65 })
  })

  it('snaps both bounds of a channel', () => {
    const input = toAlertInput(
      draft({ condition: 'enteringRange', value: '1293.6305', upperValue: '1301.2207' }),
      chart(),
      drawings,
      'RELIANCE',
      at
    )
    expect(input?.source).toMatchObject({ price: 1293.65, upperPrice: 1301.2 })
  })

  it('names the alert after the price it will be armed at', () => {
    // Otherwise the list says one number and the chart line sits at another,
    // and the difference is a tick nobody can see in either place.
    expect(titleFor(draft({ value: '1293.6305656934308' }), chart(), 'RELIANCE', at)).toBe(
      'RELIANCE crossing 1293.65'
    )
  })

  it('gives a generated name the snapped price too', () => {
    // The name is generated inside toAlertInput when the trader leaves the
    // field blank, and that call has to pass the tick on. Without it the row
    // read "crossing 1293.6305656934308" beside a line armed at 1293.65.
    const input = toAlertInput(
      draft({ title: '', value: '1293.6305656934308' }),
      chart(),
      drawings,
      'RELIANCE',
      at
    )
    expect(input?.title).toBe('RELIANCE crossing 1293.65')
  })

  it('renames a dragged alert after the price its line now sits at', () => {
    // The engine moves the source on a drag and leaves the name alone, so a
    // generated name went on advertising the price the alert was made at.
    const alert = {
      source: { kind: 'price', price: 1260.5486842105263 },
      condition: 'crossing',
      title: 'RELIANCE crossing 1226.4',
    } as unknown as Parameters<typeof alertTitleFor>[0]
    expect(alertTitleFor(alert, chart(), 'RELIANCE', at)).toBe('RELIANCE crossing 1260.55')
  })

  it('names a dragged channel after both of its bounds', () => {
    const alert = {
      source: { kind: 'price', price: 1293.6305, upperPrice: 1301.2207 },
      condition: 'enteringRange',
      title: 'old',
    } as unknown as Parameters<typeof alertTitleFor>[0]
    expect(alertTitleFor(alert, chart(), 'RELIANCE', at)).toBe(
      'RELIANCE entering channel 1293.65 and 1301.2'
    )
  })

  it('leaves a study threshold in its own units', () => {
    // An oscillator that runs nought to a hundred has nothing to do with the
    // instrument's tick, and snapping 30.02 to 30.05 would be inventing
    // precision the plot does not have.
    const input = toAlertInput(
      draft({ kind: 'indicator', value: '30.0217' }),
      chart(),
      drawings,
      'R',
      at
    )
    expect(input?.source).toMatchObject({ kind: 'indicator', value: 30.0217 })
    // And the name follows the same rule, or the list would advertise a
    // precision the plot does not have while the alert watches another number.
    expect(titleFor(draft({ kind: 'indicator', value: '30.0217' }), chart(), 'R', at)).toContain(
      '30.0217'
    )
  })

  it('passes a price straight through when the tick is unknown', () => {
    // A chart with no instrument metadata yet. Better an unrounded price than
    // one snapped to a tick invented for the occasion.
    expect(snapPrice(1293.6305656934308, undefined)).toBe(1293.6305656934308)
    expect(snapPrice(Number.NaN, at)).toBeNaN()
  })
})

/**
 * A right-click makes the alert; the toolbar opens the form.
 *
 * Both seed from `draftFor`, and that is the point of it existing. Right-clicking
 * a price creates an alert there and then, with no form in between, so if the
 * gesture seeded separately from the form the two would drift, and the drift
 * would show as a right-click quietly producing a different alert from the one
 * the form said it would propose.
 */
describe('the draft a right-click and the form both start from', () => {
  const zone = 'Asia/Kolkata'
  const at = { tick: 0.05, refPrice: 1293 }

  it('takes its price from what was clicked, on the tick', () => {
    // The reported case: a pixel maps to a price with a dozen decimals behind
    // it, and an alert made by pointing must still be tradeable.
    const made = draftFor({
      chart: chart(),
      drawings,
      zone,
      at,
      source: { kind: 'price', price: 1293.6305656934308 } as never,
    })
    expect(made.kind).toBe('price')
    expect(made.value).toBe('1293.65')
  })

  it('leaves the name blank so the generated one follows the price', () => {
    const made = draftFor({ chart: chart(), drawings, zone, at })
    expect(made.title).toBe('')
  })

  it('fires the moment the price is reached, once, unless told otherwise', () => {
    // The defaults a right-click commits to without asking.
    //
    // Intrabar, because an alert is about a price being reached and that is
    // when it is reached. Waiting for the candle to close reports a level
    // touched at 13:15 on an hourly chart at 14:15, and on a daily chart the
    // next session; it was reported as an alert that simply does not fire.
    // Once, and enabled, because a gesture with no form must not silently arm
    // something that repeats.
    const made = draftFor({ chart: chart(), drawings, zone, at })
    expect(made.policy).toBe('onTouch')
    expect(made.repeat).toBe('once')
    expect(made.enabled).toBe(true)
  })

  it('leaves an alert being edited on the policy it already had', () => {
    // Changing the default must not rewrite alerts somebody already made and
    // is only opening to rename.
    const existing = {
      id: 'a1',
      source: { kind: 'price', price: 1243.4, paneIndex: 0 },
      condition: 'crossing',
      policy: 'onBarClose',
      repeat: 'once',
      state: 'armed',
      title: 'RELIANCE crossing 1243.4',
      cooldownSeconds: 0,
      scope: { symbol: 'RELIANCE', exchange: 'NSE', interval: '5m' },
    } as unknown as Parameters<typeof draftFor>[0]['existing']
    expect(draftFor({ chart: chart(), drawings, zone, at, existing }).policy).toBe('onBarClose')
  })

  it('makes a sound and a notification, and sends nothing outward', () => {
    expect(draftFor({ chart: chart(), drawings, zone, at }).deliver).toEqual(DEFAULT_DELIVERY)
  })

  it('seeds an existing alert from itself rather than from the click', () => {
    // The editor path. An alert being edited must not be re-seeded from
    // whatever the pointer was last over.
    const existing = {
      source: { kind: 'price', price: 1300 },
      condition: 'lessThan',
      policy: 'intrabar',
      repeat: 'always',
      state: 'disabled',
      title: 'Cover the short',
      cooldownSeconds: 30,
    } as never
    // Handed a competing click as well, because that is the case the
    // precedence exists for: opening the editor on an alert must not re-seed it
    // from wherever the pointer happened to be last.
    const made = draftFor({
      chart: chart(),
      drawings,
      zone,
      at,
      existing,
      source: { kind: 'price', price: 999.95 } as never,
    })
    expect(made.value).toBe('1300')
    expect(made.condition).toBe('lessThan')
    expect(made.policy).toBe('intrabar')
    expect(made.enabled).toBe(false)
    expect(made.title).toBe('Cover the short')
  })

  it('is the same draft whether a form or a gesture asks for it', () => {
    // Two calls with the same click produce the same alert, which is the whole
    // reason the two paths share this.
    const source = { kind: 'price', price: 1293.6305656934308 } as never
    const one = draftFor({ chart: chart(), drawings, zone, at, source })
    const other = draftFor({ chart: chart(), drawings, zone, at, source })
    expect(one).toEqual(other)
  })

  it('produces an alert the engine takes', () => {
    const made = draftFor({
      chart: chart(),
      drawings,
      zone,
      at,
      source: { kind: 'price', price: 1293.6305656934308 } as never,
    })
    const input = toAlertInput(made, chart(), drawings, 'RELIANCE', at)
    expect(input).not.toBeNull()
    expect(input?.source).toMatchObject({ kind: 'price', price: 1293.65 })
    expect(input?.title).toBe('RELIANCE crossing 1293.65')
  })

  it('builds a multi-condition alert input with registered barCondition source and payload config', () => {
    const multiDraft = draft({
      kind: 'advanced',
      advancedLogic: 'and',
      advancedConditions: [
        {
          id: 'c1',
          timeframe: '1m',
          left: { type: 'indicator', indicator: 'ema', period: 9 },
          operator: 'crossingUp',
          right: { type: 'indicator', indicator: 'ema', period: 21 },
        },
        {
          id: 'c2',
          timeframe: '5m',
          left: { type: 'indicator', indicator: 'rsi', period: 14 },
          operator: 'greaterThan',
          right: { type: 'value', value: 60 },
        },
      ],
    })

    const input = toAlertInput(multiDraft, chart(), drawings, 'NIFTY')
    expect(input).not.toBeNull()
    expect(input?.source.kind).toBe('barCondition')
    expect(input?.source).toHaveProperty('id')
    expect(input?.title).toBe('NIFTY Multi-Condition (2 conditions, AND)')
    expect((input?.payload as { advancedConfig?: unknown })?.advancedConfig).toBeDefined()
  })

  it('validates multi-condition rules (rejects more than 5 conditions)', () => {
    const conditions = Array.from({ length: 6 }, (_, i) => ({
      id: `c_${i}`,
      timeframe: 'chart',
      left: { type: 'price' as const, source: 'close' as const },
      operator: 'greaterThan' as const,
      right: { type: 'value' as const, value: 100 },
    }))

    const invalid = draft({
      kind: 'advanced',
      advancedConditions: conditions,
    })
    expect(draftProblem(invalid, chart(), drawings)).toBe('An alert supports up to 5 conditions.')
  })

  it('validates multi-condition rules (rejects empty conditions list)', () => {
    const invalid = draft({
      kind: 'advanced',
      advancedConditions: [],
    })
    expect(draftProblem(invalid, chart(), drawings)).toBe('Add at least one condition.')
  })

  it('preserves existing barCondition config ID when editing an advanced alert', () => {
    const editingDraft = draft({
      kind: 'advanced',
      barConditionId: 'adv_alert_stable_config_123',
      advancedConditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'price', source: 'close' },
          operator: 'greaterThan',
          right: { type: 'value', value: 100 },
        },
      ],
    })
    const input = toAlertInput(editingDraft, chart(), drawings, 'NIFTY')
    expect(input?.source).toMatchObject({
      kind: 'barCondition',
      id: 'adv_alert_stable_config_123',
    })
    const payload = input?.payload as { advancedConfig?: { id: string } }
    expect(payload?.advancedConfig?.id).toBe('stable_config_123')
  })

  it('validates multi-condition rules (rejects indicator left operand with no indicator selected)', () => {
    const invalid = draft({
      kind: 'advanced',
      advancedConditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'indicator' as const, indicator: undefined },
          operator: 'greaterThan' as const,
          right: { type: 'value' as const, value: 100 },
        },
      ],
    })
    expect(draftProblem(invalid, chart(), drawings)).toBe(
      'Condition #1: Select an indicator on the left.'
    )
  })

  it('validates multi-condition rules (rejects indicator right operand with no indicator selected)', () => {
    const invalid = draft({
      kind: 'advanced',
      advancedConditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'price' as const, source: 'close' as const },
          operator: 'greaterThan' as const,
          right: { type: 'indicator' as const, indicator: undefined },
        },
      ],
    })
    expect(draftProblem(invalid, chart(), drawings)).toBe(
      'Condition #1: Select an indicator on the right.'
    )
  })

  it('restores multi-condition configuration when editing an existing alert', () => {
    const existingAlert = {
      id: 'existing_adv',
      source: { kind: 'barCondition', id: 'adv_alert_123' },
      condition: 'crossing',
      policy: 'onBarClose',
      repeat: 'everyTime',
      state: 'armed',
      title: 'Custom Multi Alert',
      payload: {
        advancedConfig: {
          id: '123',
          logic: 'or',
          conditions: [
            {
              id: 'cond_a',
              timeframe: '15m',
              left: { type: 'price', source: 'close' },
              operator: 'greaterThan',
              right: { type: 'value', value: 2500 },
            },
          ],
        },
      },
    }

    const restored = draftFor({
      chart: chart(),
      drawings,
      zone,
      at,
      existing: existingAlert as never,
    })

    expect(restored.kind).toBe('advanced')
    expect(restored.advancedLogic).toBe('or')
    expect(restored.advancedConditions?.length).toBe(1)
    expect(restored.advancedConditions?.[0]?.timeframe).toBe('15m')
  })

  it('rejects volume conditions on index instruments', () => {
    const invalid = draft({
      kind: 'advanced',
      exchange: 'NSE_INDEX',
      advancedConditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'volume' },
          operator: 'greaterThan',
          right: { type: 'value', value: 1000 },
        },
      ],
    })
    expect(draftProblem(invalid, chart(), drawings, 'NIFTY 50')).toContain(
      'Volume is not available on index instruments'
    )
  })

  it('rejects open interest conditions on cash equities', () => {
    const invalid = draft({
      kind: 'advanced',
      exchange: 'NSE',
      instrumentInfo: { instrumenttype: 'EQ' },
      advancedConditions: [
        {
          id: 'c1',
          timeframe: 'chart',
          left: { type: 'openInterest' },
          operator: 'greaterThan',
          right: { type: 'value', value: 1000 },
        },
      ],
    })
    expect(draftProblem(invalid, chart(), drawings, 'RELIANCE')).toContain(
      'Open Interest is only available on derivative contracts'
    )
  })

  it('rejects arming alerts on expired derivative contracts', () => {
    const invalid = draft({
      kind: 'price',
      exchange: 'NFO',
      instrumentInfo: {
        instrumenttype: 'CE',
        expiry: '2020-01-01', // Expired in past
      },
    })
    expect(draftProblem(invalid, chart(), drawings, 'NIFTY20JAN12000CE')).toContain('has expired')
  })

  it('restores mixed AND/OR groups when editing an existing alert', () => {
    const existingGroupedAlert = {
      id: 'existing_grouped',
      source: { kind: 'barCondition', id: 'adv_alert_grp' },
      condition: 'matches',
      policy: 'onBarClose',
      repeat: 'everyTime',
      state: 'armed',
      title: 'Grouped Alert',
      payload: {
        advancedConfig: {
          id: 'grp_123',
          logic: 'or',
          groups: [
            { id: 'g1', logic: 'and' },
            { id: 'g2', logic: 'or' },
          ],
          conditions: [
            {
              id: 'c1',
              timeframe: 'chart',
              left: { type: 'price', source: 'close' },
              operator: 'greaterThan',
              right: { type: 'value', value: 100 },
              groupId: 'g1',
            },
            {
              id: 'c2',
              timeframe: 'chart',
              left: { type: 'volume' },
              operator: 'greaterThan',
              right: { type: 'value', value: 5000 },
              groupId: 'g2',
            },
          ],
        },
      },
    }

    const restored = draftFor({
      chart: chart(),
      drawings,
      zone,
      at,
      existing: existingGroupedAlert as never,
    })

    expect(restored.advancedGroups?.length).toBe(2)
    expect(restored.advancedGroups?.[0]?.logic).toBe('and')
    expect(restored.advancedGroups?.[1]?.logic).toBe('or')
    expect(restored.advancedConditions?.[1]?.groupId).toBe('g2')
  })

  it('restores and handles up to 5 groups with custom names and connectors', () => {
    const existing5GroupAlert = {
      id: 'alert_5groups',
      symbol: 'NIFTY',
      condition: 'matches',
      policy: 'onBarClose',
      repeat: 'everyTime',
      state: 'armed',
      title: '5 Groups Alert',
      payload: {
        advancedConfig: {
          id: 'test5',
          logic: 'or',
          conditions: [
            {
              id: 'c1',
              timeframe: 'chart',
              left: { type: 'price', source: 'close' },
              operator: 'crossing',
              right: { type: 'value', value: 100 },
              groupId: 'g1',
            },
            {
              id: 'c2',
              timeframe: 'chart',
              left: { type: 'volume' },
              operator: 'greaterThan',
              right: { type: 'value', value: 500 },
              groupId: 'g2',
            },
            {
              id: 'c3',
              timeframe: 'chart',
              left: { type: 'price', source: 'high' },
              operator: 'greaterThan',
              right: { type: 'value', value: 105 },
              groupId: 'g3',
            },
            {
              id: 'c4',
              timeframe: 'chart',
              left: { type: 'volume' },
              operator: 'greaterThan',
              right: { type: 'value', value: 1000 },
              groupId: 'g4',
            },
            {
              id: 'c5',
              timeframe: 'chart',
              left: { type: 'price', source: 'low' },
              operator: 'lessThan',
              right: { type: 'value', value: 95 },
              groupId: 'g5',
            },
          ],
          groups: [
            { id: 'g1', name: 'Group 1', logic: 'and' },
            { id: 'g2', name: 'Group 2', logic: 'and', connector: 'or' },
            { id: 'g3', name: 'Group 3', logic: 'or', connector: 'and' },
            { id: 'g4', name: 'Group 4', logic: 'and', connector: 'and' },
            { id: 'g5', name: 'Group 5', logic: 'or', connector: 'or' },
          ],
        },
      },
    }

    const restored = draftFor({
      chart: chart(),
      drawings,
      zone,
      at,
      existing: existing5GroupAlert as never,
    })

    expect(restored.advancedGroups?.length).toBe(5)
    expect(restored.advancedGroups?.[4]?.id).toBe('g5')
    expect(restored.advancedGroups?.[4]?.connector).toBe('or')
    expect(restored.advancedConditions?.length).toBe(5)

    // Verify title formatting for 5 groups
    const title = titleFor(restored, chart(), 'NIFTY', at)
    expect(title).toContain('5 Groups')

    // Verify draftProblem passes with 5 populated groups
    expect(draftProblem(restored, chart(), drawings, 'NIFTY')).toBeNull()

    // Verify draftProblem flags when a group has no assigned conditions
    const emptyGroupDraft: AlertDraft = {
      ...restored,
      advancedGroups: [
        ...restored.advancedGroups!,
        { id: 'g6', name: 'Group 6', logic: 'and', connector: 'and' },
      ],
    }
    const problem = draftProblem(emptyGroupDraft, chart(), drawings, 'NIFTY')
    expect(problem).toContain('Multi-condition alerts support up to 5 groups')

    // Verify toAlertInput passes groups with connectors cleanly
    const input = toAlertInput(restored, chart(), drawings, 'NIFTY', at)
    expect(input).not.toBeNull()
    const advConfig = (input?.payload as any)?.advancedConfig
    expect(advConfig?.groups?.length).toBe(5)
    expect(advConfig?.groups?.[2]?.connector).toBe('and')
  })

  describe('Timeframe Synchronization & Scope Resolution', () => {
    it('resolves alert interval when all rules are explicitly set to 1m', () => {
      const advDraft = draft({
        kind: 'advanced',
        advancedConditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
          {
            id: 'c2',
            timeframe: '1m',
            left: { type: 'volume' },
            operator: 'greaterThan',
            right: { type: 'value', value: 500 },
            connector: 'and',
          },
        ],
      })

      expect(resolveAlertInterval(advDraft, '1m')).toBe('1m')
      // Even if chart was temporarily on 5m, explicit 1m rules require 1m parent interval
      expect(resolveAlertInterval(advDraft, '5m')).toBe('1m')
    })

    it('resolves alert interval when rules use chart interval', () => {
      const advDraft = draft({
        kind: 'advanced',
        advancedConditions: [
          {
            id: 'c1',
            timeframe: 'chart',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
        ],
      })

      expect(resolveAlertInterval(advDraft, '1m')).toBe('1m')
      expect(resolveAlertInterval(advDraft, '5m')).toBe('5m')
      expect(resolveAlertInterval(advDraft, '15m')).toBe('15m')
    })

    it('resolves base interval to minimum timeframe for mixed multi-timeframe rules', () => {
      const advDraft = draft({
        kind: 'advanced',
        advancedConditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
          {
            id: 'c2',
            timeframe: '5m',
            left: { type: 'volume' },
            operator: 'greaterThan',
            right: { type: 'value', value: 500 },
            connector: 'and',
          },
        ],
      })

      // 1m base bars are required to evaluate 1m rule (5m can be resampled from 1m)
      expect(resolveAlertInterval(advDraft, '1m')).toBe('1m')
      expect(resolveAlertInterval(advDraft, '5m')).toBe('1m')
    })

    it('toAlertInput outputs scope with correct interval and exchange', () => {
      const advDraft = draft({
        kind: 'advanced',
        advancedConditions: [
          {
            id: 'c1',
            timeframe: '1m',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 },
          },
          {
            id: 'c2',
            timeframe: '1m',
            left: { type: 'volume' },
            operator: 'greaterThan',
            right: { type: 'value', value: 500 },
            connector: 'and',
          },
        ],
      })

      const input = toAlertInput(advDraft, chart(), drawings, 'NIFTY', undefined, '1m', 'NSE')
      expect(input).not.toBeNull()
      expect(input?.scope).toEqual({
        symbol: 'NIFTY',
        exchange: 'NSE',
        interval: '1m',
      })
    })

    it('toAlertInput includes scope for standard price alerts matching active chart interval', () => {
      const priceDraft = draft({ kind: 'price', value: '1500' })
      const input = toAlertInput(priceDraft, chart(), drawings, 'RELIANCE', undefined, '5m', 'NSE')
      expect(input).not.toBeNull()
      expect(input?.scope).toEqual({
        symbol: 'RELIANCE',
        exchange: 'NSE',
        interval: '5m',
      })
    })
  })
})

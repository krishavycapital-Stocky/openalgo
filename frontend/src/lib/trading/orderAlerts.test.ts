import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAlertStore } from '../../stores/alertStore'
import { alertSoundManager } from './alertSoundManager'
import {
  categorizeOrderStatus,
  DEFAULT_ORDER_ALERT_PREFERENCES,
  formatOrderNotice,
  handleOrderUpdateAlert,
  OrderAlertDeduplicator,
  type OrderUpdateFrame,
} from './orderAlerts'

vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    info: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
  },
}))

vi.mock('./alertNotify', () => ({
  notifyIfHidden: vi.fn(),
}))

vi.mock('./alertSoundManager', () => ({
  alertSoundManager: {
    trigger: vi.fn().mockReturnValue(true),
    dismiss: vi.fn(),
  },
}))

describe('categorizeOrderStatus', () => {
  it('identifies full fill statuses and complete quantities', () => {
    expect(categorizeOrderStatus({ order_status: 'complete' })).toBe('filled')
    expect(categorizeOrderStatus({ order_status: 'COMPLETED' })).toBe('filled')
    expect(categorizeOrderStatus({ order_status: 'filled' })).toBe('filled')
    expect(categorizeOrderStatus({ order_status: 'executed' })).toBe('filled')
    expect(
      categorizeOrderStatus({ order_status: 'open', quantity: 100, filled_quantity: 100 })
    ).toBe('filled')
    expect(categorizeOrderStatus({ order_status: 'open', quantity: 50, filled_quantity: 60 })).toBe(
      'filled'
    )
  })

  it('identifies partial fills via status string or quantity math', () => {
    expect(categorizeOrderStatus({ order_status: 'partially filled' })).toBe('partial')
    expect(categorizeOrderStatus({ order_status: 'partial' })).toBe('partial')
    expect(categorizeOrderStatus({ order_status: 'partial_fill' })).toBe('partial')
    expect(
      categorizeOrderStatus({ order_status: 'open', quantity: 100, filled_quantity: 40 })
    ).toBe('partial')
  })

  it('identifies rejections and failures', () => {
    expect(categorizeOrderStatus({ order_status: 'rejected' })).toBe('rejected')
    expect(categorizeOrderStatus({ order_status: 'FAILED' })).toBe('rejected')
    expect(categorizeOrderStatus({ order_status: 'declined' })).toBe('rejected')
    expect(categorizeOrderStatus({ order_status: 'error' })).toBe('rejected')
  })

  it('identifies cancellations and expirations', () => {
    expect(categorizeOrderStatus({ order_status: 'cancelled' })).toBe('cancelled')
    expect(categorizeOrderStatus({ order_status: 'canceled' })).toBe('cancelled')
    expect(categorizeOrderStatus({ order_status: 'expired' })).toBe('cancelled')
    expect(categorizeOrderStatus({ order_status: 'lapsed' })).toBe('cancelled')
  })

  it('treats active working states as pending (no alarm)', () => {
    expect(categorizeOrderStatus({ order_status: 'open', quantity: 100, filled_quantity: 0 })).toBe(
      'pending'
    )
    expect(categorizeOrderStatus({ order_status: 'pending' })).toBe('pending')
    expect(categorizeOrderStatus({ order_status: 'trigger pending' })).toBe('pending')
    expect(categorizeOrderStatus({ order_status: 'modify pending' })).toBe('pending')
  })

  it('returns unknown for unhandled status strings with zero fill', () => {
    expect(categorizeOrderStatus({ order_status: 'custom_unrecognized_state' })).toBe('unknown')
  })
})

describe('formatOrderNotice', () => {
  const prefs = DEFAULT_ORDER_ALERT_PREFERENCES

  it('formats full fills with action, symbol, quantity, price, and venue', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-9871',
      symbol: 'RELIANCE',
      action: 'BUY',
      quantity: 50,
      filled_quantity: 50,
      average_price: 1245.5,
      exchange: 'NSE',
    }
    const notice = formatOrderNotice('filled', frame, prefs)
    expect(notice).not.toBeNull()
    expect(notice?.title).toBe('Order Filled: BUY RELIANCE')
    expect(notice?.message).toContain('BUY 50 RELIANCE filled')
    expect(notice?.message).toContain('1,245.50')
    expect(notice?.message).toContain('on NSE')
    expect(notice?.toastType).toBe('success')
    expect(notice?.soundName).toBe('chime')
  })

  it('formats partial fills with progress metrics', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-9872',
      symbol: 'INFY',
      action: 'SELL',
      quantity: 100,
      filled_quantity: 30,
      average_price: 1850,
      exchange: 'NSE',
    }
    const notice = formatOrderNotice('partial', frame, prefs)
    expect(notice?.title).toBe('Partial Fill: SELL INFY (30/100)')
    expect(notice?.message).toContain('SELL 30/100 INFY partially filled')
    expect(notice?.toastType).toBe('info')
    expect(notice?.soundName).toBe('beep')
  })

  it('formats rejections with broker reason', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-9873',
      symbol: 'TATASTEEL',
      action: 'BUY',
      quantity: 200,
      rejection_reason: 'RMS: Margin insufficient',
    }
    const notice = formatOrderNotice('rejected', frame, prefs)
    expect(notice?.title).toBe('Order Rejected: BUY TATASTEEL')
    expect(notice?.message).toBe('BUY TATASTEEL rejected: RMS: Margin insufficient')
    expect(notice?.toastType).toBe('error')
    expect(notice?.soundName).toBe('siren')
  })

  it('formats cancellations with order ID', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-9874',
      symbol: 'SBIN',
      action: 'BUY',
    }
    const notice = formatOrderNotice('cancelled', frame, prefs)
    expect(notice?.title).toBe('Order Cancelled: BUY SBIN')
    expect(notice?.message).toContain('BUY SBIN (ID: ORD-9874) cancelled')
    expect(notice?.toastType).toBe('info')
    expect(notice?.soundName).toBe('radar')
  })
})

describe('OrderAlertDeduplicator', () => {
  let deduplicator: OrderAlertDeduplicator
  const prefs = DEFAULT_ORDER_ALERT_PREFERENCES

  beforeEach(() => {
    deduplicator = new OrderAlertDeduplicator()
  })

  it('alerts on initial fill and suppresses subsequent duplicate fill frames', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-101',
      symbol: 'SBIN',
      action: 'BUY',
      quantity: 100,
      filled_quantity: 100,
      order_status: 'complete',
      average_price: 800,
    }

    // First arrival: should alert
    const first = deduplicator.evaluate(frame, prefs)
    expect(first).not.toBeNull()
    expect(first?.category).toBe('filled')

    // Second arrival of same completed fill: duplicate, should suppress
    const second = deduplicator.evaluate(frame, prefs)
    expect(second).toBeNull()

    // Third arrival: duplicate, should suppress
    const third = deduplicator.evaluate(frame, prefs)
    expect(third).toBeNull()
  })

  it('handles incremental partial fills up to completion', () => {
    const orderid = 'ORD-PARTIAL-1'
    const base: OrderUpdateFrame = {
      orderid,
      symbol: 'NIFTY',
      action: 'BUY',
      quantity: 100,
      average_price: 24000,
    }

    // 1. First partial fill of 25 shares -> should alert
    const f1 = deduplicator.evaluate(
      { ...base, order_status: 'partial', filled_quantity: 25 },
      prefs
    )
    expect(f1).not.toBeNull()
    expect(f1?.category).toBe('partial')
    expect(f1?.title).toContain('25/100')

    // 2. Duplicate frame for 25 shares -> should suppress
    const f1Dup = deduplicator.evaluate(
      { ...base, order_status: 'partial', filled_quantity: 25 },
      prefs
    )
    expect(f1Dup).toBeNull()

    // 3. Step up to 75 shares -> should alert
    const f2 = deduplicator.evaluate(
      { ...base, order_status: 'partial', filled_quantity: 75 },
      prefs
    )
    expect(f2).not.toBeNull()
    expect(f2?.category).toBe('partial')
    expect(f2?.title).toContain('75/100')

    // 4. Step up to 100 shares (complete fill) -> should alert
    const f3 = deduplicator.evaluate(
      { ...base, order_status: 'complete', filled_quantity: 100 },
      prefs
    )
    expect(f3).not.toBeNull()
    expect(f3?.category).toBe('filled')

    // 5. Subsequent duplicate complete fill -> should suppress
    const f3Dup = deduplicator.evaluate(
      { ...base, order_status: 'complete', filled_quantity: 100 },
      prefs
    )
    expect(f3Dup).toBeNull()
  })

  it('deduplicates rejected and cancelled orders', () => {
    const rejectFrame: OrderUpdateFrame = {
      orderid: 'ORD-REJ-1',
      symbol: 'HDFC',
      action: 'SELL',
      order_status: 'rejected',
      rejection_reason: 'Account suspended',
    }

    const firstReject = deduplicator.evaluate(rejectFrame, prefs)
    expect(firstReject).not.toBeNull()

    const secondReject = deduplicator.evaluate(rejectFrame, prefs)
    expect(secondReject).toBeNull()

    const cancelFrame: OrderUpdateFrame = {
      orderid: 'ORD-CAN-1',
      symbol: 'WIPRO',
      action: 'BUY',
      order_status: 'cancelled',
    }

    const firstCancel = deduplicator.evaluate(cancelFrame, prefs)
    expect(firstCancel).not.toBeNull()

    const secondCancel = deduplicator.evaluate(cancelFrame, prefs)
    expect(secondCancel).toBeNull()
  })

  it('respects user category preferences', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-PREFS',
      symbol: 'ITC',
      action: 'BUY',
      quantity: 50,
      filled_quantity: 50,
      order_status: 'complete',
    }

    // When fills are turned off
    const disabledFills = deduplicator.evaluate(frame, { ...prefs, notifyFills: false })
    expect(disabledFills).toBeNull()

    // When master order alerts switch is turned off
    const disabledMaster = deduplicator.evaluate(frame, { ...prefs, enabled: false })
    expect(disabledMaster).toBeNull()
  })

  it('resets state on account switch or logout for account isolation', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-ACCOUNT-1',
      symbol: 'LT',
      action: 'BUY',
      quantity: 20,
      filled_quantity: 20,
      order_status: 'complete',
    }

    expect(deduplicator.evaluate(frame, prefs)).not.toBeNull()
    expect(deduplicator.evaluate(frame, prefs)).toBeNull() // suppressed

    // Reset simulating session disconnect / account logout
    deduplicator.reset()
    expect(deduplicator.trackedCount).toBe(0)

    // After reset, the order can alert again (clean account boundary)
    expect(deduplicator.evaluate(frame, prefs)).not.toBeNull()
  })
})

describe('handleOrderUpdateAlert', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useAlertStore.getState().resetToDefaults()
  })

  it('triggers toast, sound manager, and desktop notification on fill', () => {
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-DISPATCH-1',
      symbol: 'RELIANCE',
      action: 'BUY',
      quantity: 100,
      filled_quantity: 100,
      order_status: 'complete',
      average_price: 1250,
      exchange: 'NSE',
    }

    const notice = handleOrderUpdateAlert(frame)
    expect(notice).not.toBeNull()
    expect(alertSoundManager.trigger).toHaveBeenCalledWith(
      expect.objectContaining({
        soundName: 'chime',
        duration: 'once',
      })
    )
  })

  it('respects store master toast switch', () => {
    useAlertStore.getState().setToastsEnabled(false)
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-NO-TOAST',
      symbol: 'SBIN',
      action: 'BUY',
      quantity: 50,
      filled_quantity: 50,
      order_status: 'complete',
    }
    expect(handleOrderUpdateAlert(frame)).toBeNull()
  })

  it('respects store master orders category switch', () => {
    useAlertStore.getState().setCategoryEnabled('orders', false)
    const frame: OrderUpdateFrame = {
      orderid: 'ORD-NO-CATEGORY',
      symbol: 'SBIN',
      action: 'BUY',
      quantity: 50,
      filled_quantity: 50,
      order_status: 'complete',
    }
    expect(handleOrderUpdateAlert(frame)).toBeNull()
  })
})

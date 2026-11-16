/**
 * Broker Order Status Alerting & Deduplication Engine.
 *
 * Ingests real-time asynchronous broker order updates (fills, partial fills,
 * rejections, and cancellations) from Socket.IO `order_update` frames and translates
 * them into actionable user notifications, customizable audio alarms, and
 * desktop notifications.
 *
 * Requirements:
 * - Notification-only: never places, alters, or cancels any trade.
 * - Idempotent & Deduplicated: suppresses repeated broker update frames or
 *   reconnection replays.
 * - Incremental Fill Awareness: handles partial fill step increases and final full fills.
 * - Account Isolated: deduplication cache can be reset on session / account change.
 * - Credential Hygiene: never exposes API keys, auth tokens, or private secrets in logs/messages.
 */

import { toast } from 'sonner'
import { useAlertStore } from '../../stores/alertStore'
import { notifyIfHidden } from './alertNotify'
import {
  type AlertSoundDuration,
  type AlertSoundName,
  alertSoundManager,
} from './alertSoundManager'

export interface OrderAlertPreferences {
  readonly enabled: boolean
  readonly notifyFills: boolean
  readonly notifyPartialFills: boolean
  readonly notifyRejections: boolean
  readonly notifyCancellations: boolean
  readonly fillSound: AlertSoundName
  readonly partialFillSound: AlertSoundName
  readonly rejectSound: AlertSoundName
  readonly cancelSound: AlertSoundName
  readonly soundDuration: AlertSoundDuration
  readonly desktopNotification: boolean
}

export const DEFAULT_ORDER_ALERT_PREFERENCES: OrderAlertPreferences = {
  enabled: true,
  notifyFills: true,
  notifyPartialFills: true,
  notifyRejections: true,
  notifyCancellations: true,
  fillSound: 'chime',
  partialFillSound: 'beep',
  rejectSound: 'siren',
  cancelSound: 'radar',
  soundDuration: 'once',
  desktopNotification: true,
}

export type OrderStatusCategory =
  | 'filled'
  | 'partial'
  | 'rejected'
  | 'cancelled'
  | 'pending'
  | 'unknown'

export interface OrderUpdateFrame {
  readonly mode?: string
  readonly broker?: string
  readonly orderid?: string | number
  readonly symbol?: string
  readonly exchange?: string
  readonly action?: string
  readonly quantity?: unknown
  readonly price?: unknown
  readonly trigger_price?: unknown
  readonly pricetype?: string
  readonly product?: string
  readonly order_status?: string
  readonly filled_quantity?: unknown
  readonly pending_quantity?: unknown
  readonly average_price?: unknown
  readonly rejection_reason?: string
}

export interface OrderAlertNotice {
  readonly category: OrderStatusCategory
  readonly title: string
  readonly message: string
  readonly soundName: AlertSoundName
  readonly soundDuration: AlertSoundDuration
  readonly toastType: 'success' | 'info' | 'error'
  readonly tag: string
}

/** Safely normalizes text without throwing or revealing undefined/null. */
function safeText(val: unknown): string {
  if (val === null || val === undefined) return ''
  return String(val).trim()
}

/** Safely normalizes numeric values without NaN/Infinity. */
function safeNum(val: unknown): number {
  if (val === null || val === undefined) return 0
  const n = typeof val === 'number' ? val : Number(val)
  return Number.isFinite(n) ? n : 0
}

/** Formats currency amounts with commas and standard Indian rupee notation when applicable. */
function formatPrice(price: number): string {
  if (price === 0) return '0.00'
  return price.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
}

/**
 * Normalizes broker-specific order status text and quantity metrics into
 * canonical categories: filled, partial, rejected, cancelled, pending, or unknown.
 */
export function categorizeOrderStatus(frame: OrderUpdateFrame): OrderStatusCategory {
  const status = safeText(frame.order_status).toLowerCase()
  const filledQty = safeNum(frame.filled_quantity)
  const totalQty = safeNum(frame.quantity)

  // Explicit completion or all shares filled
  if (
    status === 'complete' ||
    status === 'completed' ||
    status === 'filled' ||
    status === 'executed' ||
    (totalQty > 0 && filledQty >= totalQty)
  ) {
    return 'filled'
  }

  // Explicit rejections / failures
  if (status === 'rejected' || status === 'failed' || status === 'declined' || status === 'error') {
    return 'rejected'
  }

  // Explicit cancellations
  if (
    status === 'cancelled' ||
    status === 'canceled' ||
    status === 'expired' ||
    status === 'lapsed'
  ) {
    return 'cancelled'
  }

  // Partial fills: either status says partial or partial filled quantity is present
  if (
    status === 'partial' ||
    status === 'partially filled' ||
    status === 'partial_fill' ||
    status === 'partially_filled' ||
    (totalQty > 0 && filledQty > 0 && filledQty < totalQty)
  ) {
    return 'partial'
  }

  // Working / Pending order states
  if (
    status === 'open' ||
    status === 'pending' ||
    status === 'trigger pending' ||
    status === 'validation pending' ||
    status === 'open pending' ||
    status === 'modify pending' ||
    status === 'cancel pending' ||
    status.endsWith(' pending')
  ) {
    return 'pending'
  }

  return 'unknown'
}

/**
 * Generates human-readable, sanitized titles and messages for order updates.
 * Guards against leaking sensitive credentials or authentication tokens.
 */
export function formatOrderNotice(
  category: OrderStatusCategory,
  frame: OrderUpdateFrame,
  prefs: OrderAlertPreferences
): OrderAlertNotice | null {
  const symbol = safeText(frame.symbol) || 'Order'
  const action = safeText(frame.action).toUpperCase() || 'ORDER'
  const orderid = safeText(frame.orderid)
  const exchange = safeText(frame.exchange)
  const totalQty = safeNum(frame.quantity)
  const filledQty = safeNum(frame.filled_quantity)
  const avgPrice = safeNum(frame.average_price) || safeNum(frame.price)
  const venue = exchange ? ` on ${exchange}` : ''

  switch (category) {
    case 'filled': {
      const displayQty = filledQty > 0 ? filledQty : totalQty
      const priceStr = avgPrice > 0 ? ` @ ₹${formatPrice(avgPrice)}` : ''
      return {
        category,
        title: `Order Filled: ${action} ${symbol}`,
        message: `${action} ${displayQty} ${symbol} filled${priceStr}${venue}`,
        soundName: prefs.fillSound,
        soundDuration: prefs.soundDuration,
        toastType: 'success',
        tag: `order_${orderid || symbol}_fill`,
      }
    }
    case 'partial': {
      const priceStr = avgPrice > 0 ? ` @ ₹${formatPrice(avgPrice)}` : ''
      const qtyStr = totalQty > 0 ? `${filledQty}/${totalQty}` : `${filledQty}`
      return {
        category,
        title: `Partial Fill: ${action} ${symbol} (${qtyStr})`,
        message: `${action} ${qtyStr} ${symbol} partially filled${priceStr}${venue}`,
        soundName: prefs.partialFillSound,
        soundDuration: prefs.soundDuration,
        toastType: 'info',
        tag: `order_${orderid || symbol}_partial_${filledQty}`,
      }
    }
    case 'rejected': {
      const reason = safeText(frame.rejection_reason) || 'Broker rejected order'
      return {
        category,
        title: `Order Rejected: ${action} ${symbol}`,
        message: `${action} ${symbol} rejected: ${reason}`,
        soundName: prefs.rejectSound,
        soundDuration: prefs.soundDuration,
        toastType: 'error',
        tag: `order_${orderid || symbol}_reject`,
      }
    }
    case 'cancelled': {
      return {
        category,
        title: `Order Cancelled: ${action} ${symbol}`,
        message: `${action} ${symbol}${orderid ? ` (ID: ${orderid})` : ''} cancelled`,
        soundName: prefs.cancelSound,
        soundDuration: prefs.soundDuration,
        toastType: 'info',
        tag: `order_${orderid || symbol}_cancel`,
      }
    }
    default:
      return null
  }
}

interface OrderTracker {
  category: OrderStatusCategory
  filledQuantity: number
  timestamp: number
}

/**
 * State tracking and deduplication engine for broker updates.
 * Guarantees that duplicate socket frames, reconnect replays, or repeated
 * polls do not trigger duplicate sounds or redundant notifications.
 */
export class OrderAlertDeduplicator {
  private readonly orders = new Map<string, OrderTracker>()
  private readonly maxTracked = 1000
  private readonly ttlMs = 15 * 60 * 1000 // 15 minutes TTL

  /**
   * Evaluates an incoming order frame against history and user preferences.
   * Returns an `OrderAlertNotice` if an alert should be dispatched, or null if suppressed.
   */
  public evaluate(frame: OrderUpdateFrame, prefs: OrderAlertPreferences): OrderAlertNotice | null {
    if (!prefs.enabled) return null

    const category = categorizeOrderStatus(frame)
    // Only alert on terminal states or partial fills; working/pending orders do not ring alarms
    if (category === 'pending' || category === 'unknown') return null

    // Check category preferences
    if (category === 'filled' && !prefs.notifyFills) return null
    if (category === 'partial' && !prefs.notifyPartialFills) return null
    if (category === 'rejected' && !prefs.notifyRejections) return null
    if (category === 'cancelled' && !prefs.notifyCancellations) return null

    const orderid = safeText(frame.orderid)
    if (!orderid) return null

    const filledQty = safeNum(frame.filled_quantity)
    const now = Date.now()
    const existing = this.orders.get(orderid)

    if (existing) {
      // 1. If order was already marked filled, ignore duplicate frames
      if (existing.category === 'filled' && category === 'filled') {
        return null
      }

      // 2. If order was already rejected or cancelled, ignore duplicate rejections/cancellations
      if (
        (existing.category === 'rejected' && category === 'rejected') ||
        (existing.category === 'cancelled' && category === 'cancelled')
      ) {
        return null
      }

      // 3. For partial fills, only alert if filled quantity strictly increased
      if (category === 'partial') {
        if (filledQty <= existing.filledQuantity) {
          return null
        }
      }
    }

    // Update tracking state
    this.orders.set(orderid, {
      category,
      filledQuantity: filledQty,
      timestamp: now,
    })

    // Housekeeping: prune old records when limit exceeded
    if (this.orders.size > this.maxTracked) {
      this.prune(now)
    }

    return formatOrderNotice(category, frame, prefs)
  }

  /** Cleans up stale tracked orders older than TTL. */
  private prune(now: number): void {
    for (const [id, entry] of this.orders.entries()) {
      if (now - entry.timestamp > this.ttlMs) {
        this.orders.delete(id)
      }
    }
  }

  /** Resets tracking history (used on user logout, account switch, or test teardown). */
  public reset(): void {
    this.orders.clear()
  }

  /** Returns current count of tracked active orders. */
  public get trackedCount(): number {
    return this.orders.size
  }
}

/** Global singleton deduplicator for order status alerts. */
export const orderAlertDeduplicator = new OrderAlertDeduplicator()

/**
 * High-level processor for an incoming `order_update` Socket.IO frame.
 * Applies deduplication, updates preferences, triggers audio synthesizer,
 * displays toast, and dispatches desktop notifications when tab is hidden.
 */
export function handleOrderUpdateAlert(
  frame: OrderUpdateFrame,
  injectedPrefs?: OrderAlertPreferences
): OrderAlertNotice | null {
  const store = useAlertStore.getState()
  // Master switches
  if (!store.toastsEnabled) return null
  if (!store.categories.orders) return null

  const prefs =
    injectedPrefs ??
    ((store as unknown as { orderAlerts?: OrderAlertPreferences }).orderAlerts) ??
    DEFAULT_ORDER_ALERT_PREFERENCES
  const notice = orderAlertDeduplicator.evaluate(frame, prefs)
  if (!notice) return null

  // 1. In-App Toast
  toast[notice.toastType](notice.message)

  // 2. Procedural Web Audio Synthesizer
  if (store.soundEnabled) {
    alertSoundManager.trigger({
      id: notice.tag,
      title: notice.title,
      soundName: notice.soundName,
      duration: notice.soundDuration,
    })
  }

  // 3. OS Desktop Notification (shown when tab is backgrounded)
  if (prefs.desktopNotification) {
    notifyIfHidden({
      title: notice.title,
      body: notice.message,
      tag: notice.tag,
    })
  }

  return notice
}

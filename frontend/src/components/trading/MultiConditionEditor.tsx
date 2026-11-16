import { Plus, Trash2 } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  type BuiltinIndicatorType,
  type ConditionGroupConfig,
  type ConditionOperand,
  type ConditionOperator,
  formatPrecedenceExpression,
  type SingleAlertCondition,
  TIMEFRAME_OPTIONS,
} from '@/lib/trading/advancedAlerts'
import { isRangeCondition } from '@/lib/trading/alertsModel'
import {
  openInterestCapability,
  parseContractDetails,
  volumeCapability,
} from '@/lib/trading/openInterest'

const INDICATOR_OPTIONS: readonly { value: BuiltinIndicatorType; label: string }[] = [
  { value: 'ema', label: 'EMA (Exponential MA)' },
  { value: 'sma', label: 'SMA (Simple MA)' },
  { value: 'rsi', label: 'RSI' },
  { value: 'macd', label: 'MACD' },
  { value: 'supertrend', label: 'Supertrend' },
  { value: 'vwap', label: 'VWAP' },
  { value: 'bollinger', label: 'Bollinger Bands' },
  { value: 'atr', label: 'ATR' },
  { value: 'adx', label: 'ADX / DMI' },
]

const OPERATOR_OPTIONS: readonly { value: ConditionOperator; label: string }[] = [
  { value: 'crossing', label: 'Crosses' },
  { value: 'crossingUp', label: 'Crosses Up' },
  { value: 'crossingDown', label: 'Crosses Down' },
  { value: 'greaterThan', label: 'Greater Than' },
  { value: 'lessThan', label: 'Less Than' },
  { value: 'enteringRange', label: 'Entering Channel' },
  { value: 'leavingRange', label: 'Leaving Channel' },
]

const SOURCE_OPTIONS: readonly {
  value: 'close' | 'open' | 'high' | 'low' | 'hl2' | 'hlc3'
  label: string
}[] = [
    { value: 'close', label: 'Close' },
    { value: 'open', label: 'Open' },
    { value: 'high', label: 'High' },
    { value: 'low', label: 'Low' },
    { value: 'hl2', label: 'HL2 (High+Low)/2' },
    { value: 'hlc3', label: 'HLC3 (Typical Price)' },
  ]

interface OperandEditorProps {
  label: string
  operand: ConditionOperand
  allowValue?: boolean
  allowVolume?: boolean
  allowOpenInterest?: boolean
  volumeDisabledReason?: string
  oiDisabledReason?: string
  onChange(next: ConditionOperand): void
}

function OperandEditor({
  label,
  operand,
  allowValue = true,
  allowVolume = true,
  allowOpenInterest = true,
  volumeDisabledReason,
  oiDisabledReason,
  onChange,
}: OperandEditorProps) {
  return (
    <div className="space-y-1.5 rounded bg-background/50 p-2 border border-border/50 text-xs">
      <div className="flex items-center justify-between text-muted-foreground font-medium">
        <span>{label}</span>
        <div className="flex flex-wrap gap-1">
          <button
            type="button"
            className={`px-1.5 py-0.5 rounded text-[11px] ${operand.type === 'price' ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted hover:bg-muted/80'}`}
            onClick={() => onChange({ type: 'price', source: 'close' })}
          >
            Price
          </button>
          <button
            type="button"
            title={volumeDisabledReason || 'Watch bar volume (candle)'}
            disabled={allowVolume === false}
            className={`px-1.5 py-0.5 rounded text-[11px] ${operand.type === 'volume'
                ? 'bg-primary text-primary-foreground font-medium'
                : allowVolume === false
                  ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            onClick={() => onChange({ type: 'volume' })}
          >
            Volume
          </button>
          <button
            type="button"
            title={oiDisabledReason || 'Watch open interest (derivatives only)'}
            disabled={allowOpenInterest === false}
            className={`px-1.5 py-0.5 rounded text-[11px] ${operand.type === 'openInterest'
                ? 'bg-primary text-primary-foreground font-medium'
                : allowOpenInterest === false
                  ? 'opacity-40 cursor-not-allowed bg-muted text-muted-foreground'
                  : 'bg-muted hover:bg-muted/80'
              }`}
            onClick={() => onChange({ type: 'openInterest' })}
          >
            OI
          </button>
          <button
            type="button"
            className={`px-1.5 py-0.5 rounded text-[11px] ${operand.type === 'indicator' ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted hover:bg-muted/80'}`}
            onClick={() => onChange({ type: 'indicator', indicator: 'ema', period: 9 })}
          >
            Indicator
          </button>
          {allowValue && (
            <button
              type="button"
              className={`px-1.5 py-0.5 rounded text-[11px] ${operand.type === 'value' ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted hover:bg-muted/80'}`}
              onClick={() => onChange({ type: 'value', value: 0 })}
            >
              Value
            </button>
          )}
        </div>
      </div>

      {operand.type === 'price' && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Source:</span>
          <Select
            value={operand.source ?? 'close'}
            onValueChange={(val) =>
              onChange({ ...operand, source: val as ConditionOperand['source'] })
            }
          >
            <SelectTrigger className="h-7 text-xs flex-1">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {SOURCE_OPTIONS.map((opt) => (
                <SelectItem key={opt.value} value={opt.value} className="text-xs">
                  {opt.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {operand.type === 'volume' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Mode:</span>
            <Select
              value={operand.indicator ?? 'raw'}
              onValueChange={(val) => {
                if (val === 'raw') {
                  onChange({ type: 'volume' })
                } else {
                  onChange({ type: 'volume', indicator: val as 'sma' | 'ema', period: 20 })
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="raw" className="text-xs">
                  Bar Volume (Candle)
                </SelectItem>
                <SelectItem value="sma" className="text-xs">
                  Volume SMA
                </SelectItem>
                <SelectItem value="ema" className="text-xs">
                  Volume EMA
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {operand.indicator && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">MA Period:</span>
              <Input
                type="number"
                min={2}
                max={500}
                value={operand.period ?? 20}
                onChange={(e) =>
                  onChange({ ...operand, period: Math.max(2, Number(e.target.value) || 20) })
                }
                className="h-7 text-xs w-24"
              />
            </div>
          )}
        </div>
      )}

      {operand.type === 'openInterest' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Mode:</span>
            <Select
              value={operand.indicator ?? 'raw'}
              onValueChange={(val) => {
                if (val === 'raw') {
                  onChange({ type: 'openInterest' })
                } else {
                  onChange({ type: 'openInterest', indicator: val as 'sma' | 'ema', period: 14 })
                }
              }}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="raw" className="text-xs">
                  Bar Open Interest (Level)
                </SelectItem>
                <SelectItem value="sma" className="text-xs">
                  OI SMA
                </SelectItem>
                <SelectItem value="ema" className="text-xs">
                  OI EMA
                </SelectItem>
              </SelectContent>
            </Select>
          </div>
          {operand.indicator && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">MA Period:</span>
              <Input
                type="number"
                min={2}
                max={500}
                value={operand.period ?? 14}
                onChange={(e) =>
                  onChange({ ...operand, period: Math.max(2, Number(e.target.value) || 14) })
                }
                className="h-7 text-xs w-24"
              />
            </div>
          )}
        </div>
      )}

      {operand.type === 'indicator' && (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2">
            <span className="text-muted-foreground">Type:</span>
            <Select
              value={operand.indicator ?? 'ema'}
              onValueChange={(val) => {
                const ind = val as BuiltinIndicatorType
                onChange({
                  ...operand,
                  indicator: ind,
                  period:
                    ind === 'supertrend'
                      ? 10
                      : ind === 'rsi' || ind === 'atr' || ind === 'adx'
                        ? 14
                        : ind === 'bollinger'
                          ? 20
                          : 9,
                  multiplier: ind === 'supertrend' ? 3 : ind === 'bollinger' ? 2 : undefined,
                  fastPeriod: ind === 'macd' ? 12 : undefined,
                  slowPeriod: ind === 'macd' ? 26 : undefined,
                  signalPeriod: ind === 'macd' ? 9 : undefined,
                  plotKey:
                    ind === 'macd'
                      ? 'macd'
                      : ind === 'supertrend'
                        ? 'supertrend'
                        : ind === 'bollinger'
                          ? 'upper'
                          : ind === 'adx'
                            ? 'adx'
                            : undefined,
                })
              }}
            >
              <SelectTrigger className="h-7 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {INDICATOR_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value} className="text-xs">
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Indicator parameters */}
          {operand.indicator !== 'macd' &&
            operand.indicator !== 'supertrend' &&
            operand.indicator !== 'vwap' && (
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Period:</span>
                <Input
                  type="number"
                  min={1}
                  max={500}
                  value={operand.period ?? 14}
                  onChange={(e) => onChange({ ...operand, period: Number(e.target.value) })}
                  className="h-7 text-xs w-20"
                />
              </div>
            )}

          {operand.indicator === 'supertrend' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Period:</span>
                <Input
                  type="number"
                  min={1}
                  value={operand.period ?? 10}
                  onChange={(e) => onChange({ ...operand, period: Number(e.target.value) })}
                  className="h-7 text-xs flex-1"
                />
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Mult:</span>
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={operand.multiplier ?? 3}
                  onChange={(e) => onChange({ ...operand, multiplier: Number(e.target.value) })}
                  className="h-7 text-xs flex-1"
                />
              </div>
            </div>
          )}

          {operand.indicator === 'bollinger' && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">Band:</span>
                <Select
                  value={operand.plotKey ?? 'upper'}
                  onValueChange={(val) => onChange({ ...operand, plotKey: val })}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="upper" className="text-xs">
                      Upper Band
                    </SelectItem>
                    <SelectItem value="middle" className="text-xs">
                      Middle (SMA)
                    </SelectItem>
                    <SelectItem value="lower" className="text-xs">
                      Lower Band
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-muted-foreground">StdDev:</span>
                <Input
                  type="number"
                  min={0.5}
                  step={0.5}
                  value={operand.multiplier ?? 2}
                  onChange={(e) => onChange({ ...operand, multiplier: Number(e.target.value) })}
                  className="h-7 text-xs flex-1"
                />
              </div>
            </div>
          )}

          {operand.indicator === 'adx' && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Line:</span>
              <Select
                value={operand.plotKey ?? 'adx'}
                onValueChange={(val) => onChange({ ...operand, plotKey: val })}
              >
                <SelectTrigger className="h-7 text-xs flex-1">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="adx" className="text-xs">
                    ADX Line
                  </SelectItem>
                  <SelectItem value="plusDi" className="text-xs">
                    +DI (Positive)
                  </SelectItem>
                  <SelectItem value="minusDi" className="text-xs">
                    -DI (Negative)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          )}

          {operand.indicator === 'macd' && (
            <div className="space-y-1.5">
              <div className="grid grid-cols-3 gap-1.5">
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Fast:</span>
                  <Input
                    type="number"
                    min={1}
                    value={operand.fastPeriod ?? 12}
                    onChange={(e) => onChange({ ...operand, fastPeriod: Number(e.target.value) })}
                    className="h-6 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Slow:</span>
                  <Input
                    type="number"
                    min={1}
                    value={operand.slowPeriod ?? 26}
                    onChange={(e) => onChange({ ...operand, slowPeriod: Number(e.target.value) })}
                    className="h-6 text-xs"
                  />
                </div>
                <div className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">Signal:</span>
                  <Input
                    type="number"
                    min={1}
                    value={operand.signalPeriod ?? 9}
                    onChange={(e) => onChange({ ...operand, signalPeriod: Number(e.target.value) })}
                    className="h-6 text-xs"
                  />
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-muted-foreground">Plot:</span>
                <Select
                  value={operand.plotKey ?? 'macd'}
                  onValueChange={(val) => onChange({ ...operand, plotKey: val })}
                >
                  <SelectTrigger className="h-7 text-xs flex-1">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="macd" className="text-xs">
                      MACD Line
                    </SelectItem>
                    <SelectItem value="signal" className="text-xs">
                      Signal Line
                    </SelectItem>
                    <SelectItem value="hist" className="text-xs">
                      Histogram
                    </SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          )}
        </div>
      )}

      {operand.type === 'value' && (
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Threshold:</span>
          <Input
            type="number"
            step="any"
            value={operand.value ?? 0}
            onChange={(e) => onChange({ ...operand, value: Number(e.target.value) })}
            className="h-7 text-xs flex-1"
          />
        </div>
      )}
    </div>
  )
}

interface ConditionCardProps {
  index: number
  condition: SingleAlertCondition
  canDelete: boolean
  isGrouped: boolean
  groups?: ConditionGroupConfig[]
  allowVolume: boolean
  allowOpenInterest: boolean
  volumeDisabledReason?: string
  oiDisabledReason?: string
  onDelete(): void
  onChange(next: SingleAlertCondition): void
}

const GROUP_THEMES = [
  {
    id: 'g1',
    label: 'G1',
    name: 'Group 1',
    color: 'text-blue-600 dark:text-blue-400',
    bg: 'bg-blue-600 text-white dark:bg-blue-500',
    border: 'border-blue-500/40',
  },
  {
    id: 'g2',
    label: 'G2',
    name: 'Group 2',
    color: 'text-purple-600 dark:text-purple-400',
    bg: 'bg-purple-600 text-white dark:bg-purple-500',
    border: 'border-purple-500/40',
  },
  {
    id: 'g3',
    label: 'G3',
    name: 'Group 3',
    color: 'text-amber-600 dark:text-amber-400',
    bg: 'bg-amber-600 text-white dark:bg-amber-500',
    border: 'border-amber-500/40',
  },
  {
    id: 'g4',
    label: 'G4',
    name: 'Group 4',
    color: 'text-emerald-600 dark:text-emerald-400',
    bg: 'bg-emerald-600 text-white dark:bg-emerald-500',
    border: 'border-emerald-500/40',
  },
  {
    id: 'g5',
    label: 'G5',
    name: 'Group 5',
    color: 'text-rose-600 dark:text-rose-400',
    bg: 'bg-rose-600 text-white dark:bg-rose-500',
    border: 'border-rose-500/40',
  },
] as const

function formatOperandSummary(op: ConditionOperand): string {
  switch (op.type) {
    case 'price':
      return `Price(${op.source ?? 'close'})`
    case 'volume':
      return op.indicator ? `Vol ${op.indicator.toUpperCase()}(${op.period ?? 20})` : 'Volume'
    case 'openInterest':
      return op.indicator ? `OI ${op.indicator.toUpperCase()}(${op.period ?? 14})` : 'Open Interest'
    case 'indicator':
      return `${(op.indicator ?? 'indicator').toUpperCase()}${op.period ? `(${op.period})` : ''}`
    case 'value':
      return String(op.value ?? 0)
    default:
      return 'Unknown'
  }
}

function formatOperatorSummary(op: ConditionOperator): string {
  switch (op) {
    case 'crossing':
      return 'Crosses'
    case 'crossingUp':
      return 'Crosses Up'
    case 'crossingDown':
      return 'Crosses Down'
    case 'greaterThan':
      return '>'
    case 'lessThan':
      return '<'
    case 'enteringRange':
      return 'Enters Channel'
    case 'leavingRange':
      return 'Leaves Channel'
    default:
      return op
  }
}

function formatConditionSummary(c: SingleAlertCondition, idx: number): string {
  const tf = c.timeframe && c.timeframe !== 'chart' ? ` [${c.timeframe}]` : ''
  const left = formatOperandSummary(c.left)
  const oper = formatOperatorSummary(c.operator)
  const right =
    isRangeCondition(c.operator) && c.right.type === 'value' && c.right.upperValue !== undefined
      ? `[${c.right.value}, ${c.right.upperValue}]`
      : formatOperandSummary(c.right)
  return `#${idx + 1}: ${left}${tf} ${oper} ${right}`
}

function ConditionCard({
  index,
  condition,
  canDelete,
  isGrouped,
  groups,
  allowVolume,
  allowOpenInterest,
  volumeDisabledReason,
  oiDisabledReason,
  onDelete,
  onChange,
}: ConditionCardProps) {
  const isRange = isRangeCondition(condition.operator)

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 space-y-2 text-xs shadow-sm">
      <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Rule #{index + 1}</span>
          {isGrouped && groups && groups.length > 1 && (
            <div className="flex items-center gap-1">
              <span className="text-[10px] text-muted-foreground font-medium">Group:</span>
              <div className="flex flex-wrap items-center gap-1">
                {groups.map((grp, gIdx) => {
                  const theme = GROUP_THEMES[gIdx % GROUP_THEMES.length]!
                  const isSelected = (condition.groupId || groups[0]!.id) === grp.id
                  return (
                    <button
                      key={grp.id}
                      type="button"
                      className={`px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors ${isSelected ? theme.bg : 'bg-muted text-muted-foreground hover:bg-muted/80'
                        }`}
                      onClick={() => onChange({ ...condition, groupId: grp.id })}
                      title={`Assign to ${grp.name || `Group ${gIdx + 1}`}`}
                    >
                      {grp.name ? grp.name.replace('Group ', 'G') : `G${gIdx + 1}`}
                    </button>
                  )
                })}
              </div>
            </div>
          )}
          <span className="text-[11px] text-muted-foreground">TF:</span>
          <Select
            value={condition.timeframe}
            onValueChange={(val) => onChange({ ...condition, timeframe: val })}
          >
            <SelectTrigger className="h-6 w-[120px] text-[11px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {TIMEFRAME_OPTIONS.map((tf) => (
                <SelectItem key={tf.value} value={tf.value} className="text-xs">
                  {tf.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        {canDelete && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
            onClick={onDelete}
            aria-label={`Remove condition ${index + 1}`}
          >
            <Trash2 className="h-3.5 w-3.5" />
          </Button>
        )}
      </div>

      <OperandEditor
        label="Left Variable"
        operand={condition.left}
        allowValue={false}
        allowVolume={allowVolume}
        allowOpenInterest={allowOpenInterest}
        volumeDisabledReason={volumeDisabledReason}
        oiDisabledReason={oiDisabledReason}
        onChange={(left) => onChange({ ...condition, left })}
      />

      <div className="flex items-center gap-2 px-1">
        <span className="text-muted-foreground font-medium">Condition:</span>
        <Select
          value={condition.operator}
          onValueChange={(val) => onChange({ ...condition, operator: val as ConditionOperator })}
        >
          <SelectTrigger className="h-7 text-xs flex-1 font-medium">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {OPERATOR_OPTIONS.map((op) => (
              <SelectItem key={op.value} value={op.value} className="text-xs">
                {op.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <OperandEditor
        label="Right Variable"
        operand={condition.right}
        allowValue={true}
        allowVolume={allowVolume}
        allowOpenInterest={allowOpenInterest}
        volumeDisabledReason={volumeDisabledReason}
        oiDisabledReason={oiDisabledReason}
        onChange={(right) => onChange({ ...condition, right })}
      />

      {isRange && condition.right.type === 'value' && (
        <div className="flex items-center gap-2 px-1 pt-1 border-t border-border/40">
          <span className="text-muted-foreground">Upper Bound:</span>
          <Input
            type="number"
            step="any"
            value={condition.right.upperValue ?? 0}
            onChange={(e) =>
              onChange({
                ...condition,
                right: { ...condition.right, upperValue: Number(e.target.value) },
              })
            }
            className="h-7 text-xs flex-1"
          />
        </div>
      )}
    </div>
  )
}

export interface MultiConditionEditorProps {
  conditions: SingleAlertCondition[]
  logic: 'and' | 'or'
  groups?: ConditionGroupConfig[]
  symbol?: string
  exchange?: string
  instrumentInfo?: Record<string, unknown>
  onChange(
    conditions: SingleAlertCondition[],
    logic: 'and' | 'or',
    groups?: ConditionGroupConfig[]
  ): void
}

export function MultiConditionEditor({
  conditions,
  logic,
  groups,
  symbol,
  exchange,
  instrumentInfo,
  onChange,
}: MultiConditionEditorProps) {
  const isLegacyGrouped = Boolean(groups && groups.length > 1)
  const isLegacyManyRules = conditions.length > 3
  const isLegacy = isLegacyGrouped || isLegacyManyRules
  const maxRules = isLegacy ? 5 : 3

  // Contract details resolution
  const contract = parseContractDetails(symbol || '', exchange || '', instrumentInfo)
  const allowVolume = volumeCapability(exchange || '', instrumentInfo)
  const allowOpenInterest = openInterestCapability(exchange || '', instrumentInfo) === true

  const volumeDisabledReason = !allowVolume
    ? 'Indices do not produce traded volume. Use futures/options contracts.'
    : undefined
  const oiDisabledReason = !allowOpenInterest
    ? 'Open Interest is only available for derivative contracts (Futures & Options).'
    : undefined

  const addCondition = () => {
    if (conditions.length >= maxRules) return
    const defaultGroup = isLegacyGrouped ? (groups?.[groups.length - 1]?.id ?? 'g1') : undefined
    const newCond: SingleAlertCondition = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'crossing',
      right: { type: 'value', value: 0 },
      connector: 'and',
      ...(defaultGroup ? { groupId: defaultGroup } : {}),
    }
    onChange([...conditions, newCond], logic, groups)
  }

  const removeCondition = (index: number) => {
    if (conditions.length <= 1) return
    const next = conditions.filter((_, i) => i !== index)
    onChange(next, logic, groups)
  }

  const updateCondition = (index: number, updated: SingleAlertCondition) => {
    const next = [...conditions]
    next[index] = updated
    onChange(next, logic, groups)
  }

    const updateConnector = (index: number, newConnector: 'and' | 'or') => {
      const next = conditions.map((c, i) => (i === index ? { ...c, connector: newConnector } : c))
      const connectors = next.slice(1).map((c) => c.connector ?? 'and')
      const effectiveLogic = connectors.every((c) => c === 'or') ? 'or' : 'and'
      onChange(next, effectiveLogic, groups)
    }

    const convertToSimplified = () => {
      const simplified = conditions.slice(0, 3).map((c, i) => ({
        ...c,
        groupId: undefined,
        connector: i > 0 ? (c.connector ?? 'and') : undefined,
      }))
      onChange(simplified, 'and', undefined)
    }

    // Legacy grouped management handlers
    const addGroup = () => {
      if (!groups || groups.length >= 5) return
      const nextNum = groups.length + 1
      const newGroupId = `g${nextNum}`
      const newGroup: ConditionGroupConfig = {
        id: newGroupId,
        name: `Group ${nextNum}`,
        logic: 'and',
        connector: 'and',
      }
      const updatedGroups = [...groups, newGroup]
      onChange(conditions, logic, updatedGroups)
    }

    const removeGroup = (groupId: string) => {
      if (!groups || groups.length <= 2) return
      const updatedGroups = groups.filter((g) => g.id !== groupId)
      const fallbackGroupId = updatedGroups[0]!.id
      const updatedConditions = conditions.map((c) =>
        c.groupId === groupId ? { ...c, groupId: fallbackGroupId } : c
      )
      onChange(updatedConditions, logic, updatedGroups)
    }

    const updateGroupLogic = (groupId: string, newLogic: 'and' | 'or') => {
      if (!groups) return
      const updated = groups.map((g) => (g.id === groupId ? { ...g, logic: newLogic } : g))
      onChange(conditions, logic, updated)
    }

    const updateGroupConnector = (groupId: string, newConnector: 'and' | 'or') => {
      if (!groups) return
      const updated = groups.map((g) => (g.id === groupId ? { ...g, connector: newConnector } : g))
      const nextLogic = groups[1]?.id === groupId ? newConnector : logic
      onChange(conditions, nextLogic, updated)
    }

    // Summary sentence generation for preview
    // 1. For Legacy Grouped alerts:
    const groupSummaries = (groups ?? []).map((grp, idx) => {
      const grpConditions = conditions.filter((c) => (c.groupId || groups![0]!.id) === grp.id)
      const grpLogicUpper = grp.logic.toUpperCase()
      const label = grp.name || `G${idx + 1}`
      const connector = idx > 0 ? (grp.connector ?? logic ?? 'or').toUpperCase() : ''
      const condStrings = grpConditions.map((c) => formatConditionSummary(c, conditions.indexOf(c)))
      const innerExpression =
        condStrings.length > 0 ? condStrings.join(` ${grpLogicUpper} `) : 'empty'

      return {
        grp,
        label,
        connector,
        count: grpConditions.length,
        logicUpper: grpLogicUpper,
        expression: `[ ${innerExpression} ]`,
        overview: `(${label}: ${grpConditions.length > 0 ? grpLogicUpper : 'empty'})`,
      }
    })

    const legacyGroupedOverview = groupSummaries
      .map((s, idx) => (idx === 0 ? s.overview : `${s.connector} ${s.overview}`))
      .join(' ')

    const legacyGroupedExpression = groupSummaries
      .map((s, idx) => (idx === 0 ? s.expression : `${s.connector} ${s.expression}`))
      .join(' ')

    // 2. For Standard V1 / Flat alerts:
    const ruleLabels = conditions.map((_, i) => `Rule #${i + 1}`)
    const ruleConnectors = conditions.slice(1).map((c) => c.connector ?? logic ?? 'and')
    const summaryExpression = formatPrecedenceExpression(ruleLabels, ruleConnectors)

    const ruleDetails = conditions.map((c, i) => `[ ${formatConditionSummary(c, i)} ]`)
    const detailedExpression = formatPrecedenceExpression(ruleDetails, ruleConnectors)

    const allAnd = ruleConnectors.length > 0 && ruleConnectors.every((c) => c === 'and')
    const allOr = ruleConnectors.length > 0 && ruleConnectors.every((c) => c === 'or')
    const statusSentence =
      conditions.length === 1
        ? 'Single Rule'
        : allAnd
          ? 'ALL Met (AND)'
          : allOr
            ? 'ANY Met (OR)'
            : 'Mixed (AND before OR)'

    return (
      <div className="space-y-2.5">
        {/* Contract information banner */}
        {(contract.isOption || contract.isFuture || contract.isIndex) && (
          <div className="flex flex-wrap items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-muted/50 border border-border/50 text-[11px]">
            <span className="font-medium text-foreground">{symbol || 'Instrument'}:</span>
            {contract.isIndex && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                Cash Index (No Volume / OI)
              </Badge>
            )}
            {contract.isFuture && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                Futures Contract {contract.expiry ? `(${contract.expiry})` : ''}
              </Badge>
            )}
            {contract.isOption && (
              <Badge variant="outline" className="text-[10px] py-0 h-4">
                Option {contract.strike ?? ''} {contract.optionType ?? ''}{' '}
                {contract.expiry ? `(${contract.expiry})` : ''}
              </Badge>
            )}
            {contract.isExpired && (
              <Badge variant="destructive" className="text-[10px] py-0 h-4">
                Expired Contract
              </Badge>
            )}
          </div>
        )}

          {/* Legacy alert notification banner */ }
      {isLegacy && (
          <div className="rounded-md border border-amber-500/30 bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-200 space-y-1.5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="font-semibold">⚠️ Legacy Multi-Condition Alert</span>
                <Badge variant="outline" className="text-[10px] border-amber-500/40">
                  {isLegacyGrouped
                    ? `${groups?.length} Groups (${conditions.length} Rules)`
                    : `${conditions.length} Rules`}
                </Badge>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-6 text-[11px] border-amber-500/40 hover:bg-amber-500/20"
                onClick={convertToSimplified}
              >
                Convert to Simplified V1 (Keep First 3 Rules)
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground leading-snug">
              This alert was saved with {isLegacyGrouped ? `mixed grouping (${groups?.length} groups)` : `${conditions.length} rules`}. All conditions and evaluation semantics are fully active and preserved without alteration.
            </p>
          </div>
        )}

        {/* Legacy Grouped Controls if existing alert uses groups */}
        {isLegacyGrouped && groups ? (
          <div className="space-y-2.5 bg-muted/40 p-2.5 rounded-md border border-border/60">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold text-foreground">
                  Legacy Groups ({groups.length} Groups)
                </span>
                <span className="text-[10px] text-muted-foreground">
                  (Up to 5 groups with AND / OR connectors)
                </span>
              </div>
              <div className="flex items-center gap-2">
                {conditions.length < 5 && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] gap-1"
                    onClick={addCondition}
                  >
                    <Plus className="h-3 w-3" />
                    Add Rule ({conditions.length}/5)
                  </Button>
                )}
                {groups.length < 5 && groups.length < conditions.length && (
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    className="h-6 text-[11px] gap-1"
                    onClick={addGroup}
                  >
                    <Plus className="h-3 w-3" />
                    Add Group ({groups.length}/5)
                  </Button>
                )}
              </div>
            </div>

            {/* Dynamic groups list with connectors */}
            <div className="space-y-2">
              {groups.map((grp, gIdx) => {
                const theme = GROUP_THEMES[gIdx % GROUP_THEMES.length]!
                const assignedCount = conditions.filter(
                  (c) => (c.groupId || groups[0]!.id) === grp.id
                ).length

                return (
                  <div key={grp.id} className="space-y-1.5">
                    {gIdx > 0 && (
                      <div className="flex items-center justify-center gap-2 py-0.5">
                        <div className="h-px bg-border flex-1" />
                        <div className="flex items-center gap-1.5 bg-background px-2 py-0.5 rounded border border-border shadow-2xs">
                          <span className="text-[10px] text-muted-foreground font-medium">
                            Connector:
                          </span>
                          <Select
                            value={grp.connector ?? logic}
                            onValueChange={(val: string) =>
                              updateGroupConnector(grp.id, val as 'and' | 'or')
                            }
                          >
                            <SelectTrigger className="h-5 text-[10px] font-bold w-[75px] px-1.5">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="and" className="text-xs">
                                AND
                              </SelectItem>
                              <SelectItem value="or" className="text-xs">
                                OR
                              </SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                        <div className="h-px bg-border flex-1" />
                      </div>
                    )}

                    <div
                      className={`flex items-center justify-between p-2 rounded border bg-background/60 ${theme.border}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${theme.bg}`}>
                          {grp.name || `Group ${gIdx + 1}`}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          ({assignedCount} rule{assignedCount === 1 ? '' : 's'}):
                        </span>
                        <Select
                          value={grp.logic}
                          onValueChange={(val: string) =>
                            updateGroupLogic(grp.id, val as 'and' | 'or')
                          }
                        >
                          <SelectTrigger className="h-6 text-xs w-[125px]">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="and" className="text-xs">
                              ALL Met (AND)
                            </SelectItem>
                            <SelectItem value="or" className="text-xs">
                              ANY Met (OR)
                            </SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      {groups.length > 2 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          className="h-6 w-6 p-0 text-muted-foreground hover:text-destructive"
                          onClick={() => removeGroup(grp.id)}
                          title={`Remove ${grp.name || `Group ${gIdx + 1}`}`}
                          aria-label={`Remove ${grp.name || `Group ${gIdx + 1}`}`}
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })}
            </div>

            <div className="space-y-1.5 rounded bg-background/80 p-2 border border-border/50 text-[11px] font-mono">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Logical Summary
                </span>
                <span className="text-[10px] text-muted-foreground">
                  (Precedence: AND binds before OR)
                </span>
              </div>
              <div className="text-xs text-foreground font-semibold">
                Evaluate: {legacyGroupedOverview}
              </div>
              <div className="pt-1 border-t border-border/40 text-[10px] text-muted-foreground break-words leading-relaxed font-sans">
                <span className="font-semibold text-foreground">Expression: </span>
                {legacyGroupedExpression}
              </div>
            </div>
          </div>
        ) : (
          /* Standard V1 Top Bar */
          <div className="flex items-center justify-between bg-muted/40 p-2 rounded-md border border-border/60">
            <div className="flex items-center gap-2">
              <span className="text-xs font-semibold text-foreground">
                Rules ({conditions.length}/{maxRules})
              </span>
              <Badge variant="secondary" className="text-[10px] font-medium px-1.5 py-0 h-5">
                {statusSentence}
              </Badge>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              className="h-7 text-xs gap-1"
              disabled={conditions.length >= maxRules}
              onClick={addCondition}
            >
              <Plus className="h-3 w-3" />
              Add Rule ({conditions.length}/{maxRules})
            </Button>
          </div>
        )}

          {/* Conditions list with adjacent AND/OR selectors */}
          <div className="space-y-2 max-h-[300px] overflow-y-auto pr-1">
            {conditions.map((cond, index) => (
          <div key={cond.id || `c_${index}`} className="space-y-2">
            {index > 0 && !isLegacyGrouped && (
              <div className="flex items-center justify-center py-0.5">
                <div className="flex items-center gap-2 bg-muted/60 dark:bg-muted/30 px-3 py-0.5 rounded-full border border-border/60 shadow-2xs">
                  <span className="text-[10px] font-semibold text-muted-foreground tracking-wider uppercase">
                    Rule #{index} & #{index + 1}:
                  </span>
                  <div className="inline-flex rounded-md p-0.5 bg-background border border-border text-[11px] font-semibold">
                    <button
                      type="button"
                      className={`px-2 py-0.5 rounded transition-colors ${
                        (cond.connector ?? 'and') === 'and'
                          ? 'bg-primary text-primary-foreground shadow-2xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => updateConnector(index, 'and')}
                      aria-label={`Connector between Rule ${index} and Rule ${index + 1}: AND`}
                    >
                      AND
                    </button>
                    <button
                      type="button"
                      className={`px-2 py-0.5 rounded transition-colors ${
                        cond.connector === 'or'
                          ? 'bg-primary text-primary-foreground shadow-2xs'
                          : 'text-muted-foreground hover:text-foreground'
                      }`}
                      onClick={() => updateConnector(index, 'or')}
                      aria-label={`Connector between Rule ${index} and Rule ${index + 1}: OR`}
                    >
                      OR
                    </button>
                  </div>
                </div>
              </div>
            )}
            <ConditionCard
              index={index}
              condition={cond}
              isGrouped={isLegacyGrouped}
              groups={groups}
              allowVolume={allowVolume}
              allowOpenInterest={allowOpenInterest}
              volumeDisabledReason={volumeDisabledReason}
              oiDisabledReason={oiDisabledReason}
              canDelete={conditions.length > 1}
              onDelete={() => removeCondition(index)}
              onChange={(updated) => updateCondition(index, updated)}
            />
          </div>
            ))}
          </div>

          {/* Live Expression Preview for Standard / Flat Rules */}
          {!isLegacyGrouped && (
            <div className="space-y-1.5 rounded bg-muted/30 p-2.5 border border-border/60 text-xs">
              <div className="flex items-center justify-between text-muted-foreground">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                  Live Evaluation Expression
                </span>
                <span className="text-[10px] text-muted-foreground font-mono">
                  (Precedence: AND evaluated before OR)
                </span>
              </div>
              <div className="text-xs font-semibold text-foreground font-mono">
                Evaluate: {summaryExpression}
              </div>
              <div className="pt-1.5 border-t border-border/40 text-[11px] text-muted-foreground break-words leading-relaxed font-sans">
                <span className="font-semibold text-foreground">Rule Details: </span>
                {detailedExpression}
              </div>
            </div>
          )}
        </div>
        )
}

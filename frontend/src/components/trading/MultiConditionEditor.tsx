import { Plus, Trash2 } from 'lucide-react'
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
  type ConditionOperand,
  type ConditionOperator,
  type SingleAlertCondition,
  TIMEFRAME_OPTIONS,
} from '@/lib/trading/advancedAlerts'
import { isRangeCondition } from '@/lib/trading/alertsModel'

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
  onChange(next: ConditionOperand): void
}

function OperandEditor({ label, operand, allowValue = true, onChange }: OperandEditorProps) {
  return (
    <div className="space-y-1.5 rounded bg-background/50 p-2 border border-border/50 text-xs">
      <div className="flex items-center justify-between text-muted-foreground font-medium">
        <span>{label}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className={`px-1.5 py-0.5 rounded text-[11px] ${operand.type === 'price' ? 'bg-primary text-primary-foreground font-medium' : 'bg-muted hover:bg-muted/80'}`}
            onClick={() => onChange({ type: 'price', source: 'close' })}
          >
            Price
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
          {['ema', 'sma', 'rsi', 'atr', 'adx', 'bollinger', 'supertrend'].includes(
            operand.indicator ?? ''
          ) && (
            <div className="flex items-center gap-2">
              <span className="text-muted-foreground">Period:</span>
              <Input
                type="number"
                min={1}
                max={500}
                value={operand.period ?? 14}
                onChange={(e) =>
                  onChange({ ...operand, period: Math.max(1, Number(e.target.value) || 14) })
                }
                className="h-7 text-xs w-20"
              />
              {operand.indicator === 'bollinger' && (
                <>
                  <span className="text-muted-foreground">StdDev:</span>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={operand.multiplier ?? 2}
                    onChange={(e) =>
                      onChange({ ...operand, multiplier: Number(e.target.value) || 2 })
                    }
                    className="h-7 text-xs w-16"
                  />
                  <Select
                    value={operand.plotKey ?? 'upper'}
                    onValueChange={(val) => onChange({ ...operand, plotKey: val })}
                  >
                    <SelectTrigger className="h-7 text-xs w-24">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="upper" className="text-xs">
                        Upper
                      </SelectItem>
                      <SelectItem value="middle" className="text-xs">
                        Middle
                      </SelectItem>
                      <SelectItem value="lower" className="text-xs">
                        Lower
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </>
              )}
              {operand.indicator === 'supertrend' && (
                <>
                  <span className="text-muted-foreground">Mult:</span>
                  <Input
                    type="number"
                    min={0.5}
                    step={0.5}
                    value={operand.multiplier ?? 3}
                    onChange={(e) =>
                      onChange({ ...operand, multiplier: Number(e.target.value) || 3 })
                    }
                    className="h-7 text-xs w-16"
                  />
                </>
              )}
              {operand.indicator === 'adx' && (
                <Select
                  value={operand.plotKey ?? 'adx'}
                  onValueChange={(val) => onChange({ ...operand, plotKey: val })}
                >
                  <SelectTrigger className="h-7 text-xs w-24">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="adx" className="text-xs">
                      ADX
                    </SelectItem>
                    <SelectItem value="plusDi" className="text-xs">
                      +DI
                    </SelectItem>
                    <SelectItem value="minusDi" className="text-xs">
                      -DI
                    </SelectItem>
                  </SelectContent>
                </Select>
              )}
            </div>
          )}

          {operand.indicator === 'macd' && (
            <div className="grid grid-cols-2 gap-1.5">
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Fast:</span>
                <Input
                  type="number"
                  min={1}
                  value={operand.fastPeriod ?? 12}
                  onChange={(e) =>
                    onChange({ ...operand, fastPeriod: Number(e.target.value) || 12 })
                  }
                  className="h-7 text-xs w-14"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Slow:</span>
                <Input
                  type="number"
                  min={1}
                  value={operand.slowPeriod ?? 26}
                  onChange={(e) =>
                    onChange({ ...operand, slowPeriod: Number(e.target.value) || 26 })
                  }
                  className="h-7 text-xs w-14"
                />
              </div>
              <div className="flex items-center gap-1">
                <span className="text-muted-foreground">Signal:</span>
                <Input
                  type="number"
                  min={1}
                  value={operand.signalPeriod ?? 9}
                  onChange={(e) =>
                    onChange({ ...operand, signalPeriod: Number(e.target.value) || 9 })
                  }
                  className="h-7 text-xs w-14"
                />
              </div>
              <div className="flex items-center gap-1">
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
  onDelete(): void
  onChange(next: SingleAlertCondition): void
}

function ConditionCard({ index, condition, canDelete, onDelete, onChange }: ConditionCardProps) {
  const isRange = isRangeCondition(condition.operator)

  return (
    <div className="rounded-lg border border-border bg-card p-2.5 space-y-2 text-xs shadow-sm">
      <div className="flex items-center justify-between border-b border-border/50 pb-1.5">
        <div className="flex items-center gap-2">
          <span className="font-semibold text-foreground">Rule #{index + 1}</span>
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
  onChange(conditions: SingleAlertCondition[], logic: 'and' | 'or'): void
}

export function MultiConditionEditor({ conditions, logic, onChange }: MultiConditionEditorProps) {
  const addCondition = () => {
    if (conditions.length >= 5) return
    const newCond: SingleAlertCondition = {
      id: `c_${Date.now()}_${Math.random().toString(36).slice(2, 5)}`,
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'crossing',
      right: { type: 'value', value: 0 },
    }
    onChange([...conditions, newCond], logic)
  }

  const removeCondition = (index: number) => {
    if (conditions.length <= 1) return
    onChange(
      conditions.filter((_, i) => i !== index),
      logic
    )
  }

  const updateCondition = (index: number, updated: SingleAlertCondition) => {
    const next = [...conditions]
    next[index] = updated
    onChange(next, logic)
  }

  return (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between bg-muted/40 p-2 rounded-md border border-border/60">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-foreground">Rule Logic:</span>
          <Select value={logic} onValueChange={(val) => onChange(conditions, val as 'and' | 'or')}>
            <SelectTrigger className="h-7 w-[160px] text-xs">
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
        <Button
          type="button"
          variant="outline"
          size="sm"
          className="h-7 text-xs gap-1"
          disabled={conditions.length >= 5}
          onClick={addCondition}
        >
          <Plus className="h-3 w-3" />
          Add Condition ({conditions.length}/5)
        </Button>
      </div>

      <div className="space-y-2.5 max-h-[290px] overflow-y-auto pr-1">
        {conditions.map((cond, index) => (
          <ConditionCard
            key={cond.id || `c_${index}`}
            index={index}
            condition={cond}
            canDelete={conditions.length > 1}
            onDelete={() => removeCondition(index)}
            onChange={(updated) => updateCondition(index, updated)}
          />
        ))}
      </div>
    </div>
  )
}

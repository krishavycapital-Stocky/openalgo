import { describe, expect, it, vi } from 'vitest'
import type { SingleAlertCondition } from '@/lib/trading/advancedAlerts'
import { render, screen, userEvent } from '@/test/test-utils'
import { MultiConditionEditor } from './MultiConditionEditor'

describe('MultiConditionEditor', () => {
  const sampleCondition: SingleAlertCondition = {
    id: 'c1',
    timeframe: 'chart',
    left: { type: 'price', source: 'close' },
    operator: 'crossing',
    right: { type: 'value', value: 1500 },
  }

  it('renders initial condition row and rule logic', () => {
    const onChange = vi.fn()
    render(<MultiConditionEditor conditions={[sampleCondition]} logic="and" onChange={onChange} />)

    expect(screen.getByText('Rule #1')).toBeInTheDocument()
    expect(screen.getByText(/ALL Met \(AND\)/i)).toBeInTheDocument()
  })

  it('allows adding conditions up to maximum of 5', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const { rerender } = render(
      <MultiConditionEditor conditions={[sampleCondition]} logic="and" onChange={onChange} />
    )

    const addBtn = screen.getByRole('button', { name: /add condition \(1\/5\)/i })
    await user.click(addBtn)

    expect(onChange).toHaveBeenCalledTimes(1)
    const newConditions = onChange.mock.calls[0]![0] as SingleAlertCondition[]
    expect(newConditions.length).toBe(2)

    // Re-render with 5 conditions
    const fiveConditions: SingleAlertCondition[] = Array.from({ length: 5 }, (_, i) => ({
      id: `c_${i}`,
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'greaterThan',
      right: { type: 'value', value: 100 * i },
    }))

    rerender(<MultiConditionEditor conditions={fiveConditions} logic="and" onChange={onChange} />)
    const disabledAddBtn = screen.getByRole('button', { name: /add condition \(5\/5\)/i })
    expect(disabledAddBtn).toBeDisabled()
  })

  it('prevents deleting the last condition', () => {
    const onChange = vi.fn()
    render(<MultiConditionEditor conditions={[sampleCondition]} logic="and" onChange={onChange} />)

    // Delete button should not be present when only 1 condition exists
    expect(screen.queryByLabelText(/remove condition 1/i)).not.toBeInTheDocument()
  })

  it('allows deleting condition when multiple exist', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    const twoConditions: SingleAlertCondition[] = [
      sampleCondition,
      {
        id: 'c2',
        timeframe: '5m',
        left: { type: 'indicator', indicator: 'rsi', period: 14 },
        operator: 'greaterThan',
        right: { type: 'value', value: 70 },
      },
    ]

    render(<MultiConditionEditor conditions={twoConditions} logic="and" onChange={onChange} />)
    const deleteBtn = screen.getByLabelText(/remove condition 1/i)
    await user.click(deleteBtn)

    expect(onChange).toHaveBeenCalledTimes(1)
    const remaining = onChange.mock.calls[0]![0] as SingleAlertCondition[]
    expect(remaining.length).toBe(1)
    expect(remaining[0]!.id).toBe('c2')
  })
})

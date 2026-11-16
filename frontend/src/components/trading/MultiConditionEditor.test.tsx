import { describe, expect, it, vi } from 'vitest'
import type { ConditionGroupConfig, SingleAlertCondition } from '@/lib/trading/advancedAlerts'
import { render, screen, userEvent } from '@/test/test-utils'
import { MultiConditionEditor } from './MultiConditionEditor'

    describe('MultiConditionEditor (V1 Simplified & Legacy Compatibility)', () => {
    const sampleCondition1: SingleAlertCondition = {
      id: 'c1',
      timeframe: 'chart',
      left: { type: 'price', source: 'close' },
      operator: 'crossing',
      right: { type: 'value', value: 1500 },
    }

      const sampleCondition2: SingleAlertCondition = {
        id: 'c2',
        timeframe: '5m',
        left: { type: 'indicator', indicator: 'rsi', period: 14 },
        operator: 'greaterThan',
        right: { type: 'value', value: 70 },
        connector: 'and',
      }

      const sampleCondition3: SingleAlertCondition = {
        id: 'c3',
        timeframe: '15m',
        left: { type: 'volume' },
        operator: 'greaterThan',
        right: { type: 'value', value: 5000 },
        connector: 'or',
      }

      it('renders initial condition row, single rule status, and live evaluation expression', () => {
        const onChange = vi.fn()
        render(<MultiConditionEditor conditions={[sampleCondition1]} logic="and" onChange={onChange} />)

        expect(screen.getByText('Rule #1')).toBeInTheDocument()
        expect(screen.getByText('Single Rule')).toBeInTheDocument()
        expect(screen.getByText(/Live Evaluation Expression/i)).toBeInTheDocument()
        expect(screen.getByText(/Evaluate: Rule #1/i)).toBeInTheDocument()
      })

        it('allows adding rules up to maximum of 3 in standard V1 view', async () => {
          const user = userEvent.setup()
          const onChange = vi.fn()
          const { rerender } = render(
      <MultiConditionEditor conditions={[sampleCondition1]} logic="and" onChange={onChange} />
          )

          const addBtn = screen.getByRole('button', { name: /add rule \(1\/3\)/i })
          await user.click(addBtn)

          expect(onChange).toHaveBeenCalledTimes(1)
          const newConditions = onChange.mock.calls[0]![0] as SingleAlertCondition[]
          expect(newConditions.length).toBe(2)

          // Re-render with 3 conditions (max limit reached in V1)
          const threeConditions: SingleAlertCondition[] = [
            sampleCondition1,
            sampleCondition2,
            sampleCondition3,
          ]

          rerender(<MultiConditionEditor conditions={threeConditions} logic="or" onChange={onChange} />)
          const disabledAddBtn = screen.getByRole('button', { name: /add rule \(3\/3\)/i })
          expect(disabledAddBtn).toBeDisabled()
        })

        it('prevents deleting the last condition', () => {
          const onChange = vi.fn()
          render(<MultiConditionEditor conditions={[sampleCondition1]} logic="and" onChange={onChange} />)

          // Delete button should not be present when only 1 condition exists
          expect(screen.queryByLabelText(/remove condition 1/i)).not.toBeInTheDocument()
        })

        it('allows deleting condition when multiple exist', async () => {
          const user = userEvent.setup()
          const onChange = vi.fn()
          render(
            <MultiConditionEditor
              conditions={[sampleCondition1, sampleCondition2]}
              logic="and"
              onChange={onChange}
            />
          )

          const deleteBtn = screen.getByLabelText(/remove condition 1/i)
          await user.click(deleteBtn)

          expect(onChange).toHaveBeenCalledTimes(1)
          const remaining = onChange.mock.calls[0]![0] as SingleAlertCondition[]
          expect(remaining.length).toBe(1)
          expect(remaining[0]!.id).toBe('c2')
        })

        it('allows toggling adjacent rule connector between AND and OR', async () => {
          const user = userEvent.setup()
          const onChange = vi.fn()
          render(
            <MultiConditionEditor
              conditions={[sampleCondition1, sampleCondition2]}
              logic="and"
              onChange={onChange}
            />
          )

          const orConnectorBtn = screen.getByLabelText(/connector between rule 1 and rule 2: or/i)
          await user.click(orConnectorBtn)

          expect(onChange).toHaveBeenCalledTimes(1)
          const updatedConditions = onChange.mock.calls[0]![0] as SingleAlertCondition[]
          expect(updatedConditions[1]!.connector).toBe('or')
        })

        it('displays precedence-aware live expression preview for mixed connectors', () => {
          const onChange = vi.fn()
          // R1 AND R2 OR R3 -> standard precedence: (Rule #1 AND Rule #2) OR Rule #3
          render(
            <MultiConditionEditor
              conditions={[
                sampleCondition1,
                { ...sampleCondition2, connector: 'and' },
                { ...sampleCondition3, connector: 'or' },
              ]}
              logic="or"
              onChange={onChange}
            />
          )

          expect(
            screen.getByText(/Evaluate: \(Rule #1 AND Rule #2\) OR Rule #3/i)
          ).toBeInTheDocument()
        })

        it('preserves legacy 5-rule alerts without truncation and shows legacy warning banner', () => {
          const onChange = vi.fn()
          const fiveConditions: SingleAlertCondition[] = Array.from({ length: 5 }, (_, i) => ({
            id: `c_${i}`,
            timeframe: 'chart',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 * (i + 1) },
          }))

          render(
            <MultiConditionEditor conditions={fiveConditions} logic="and" onChange={onChange} />
          )

          // Should display legacy alert banner and not truncate
          expect(screen.getByText(/Legacy Multi-Condition Alert/i)).toBeInTheDocument()
          expect(screen.getByText('5 Rules')).toBeInTheDocument()
          expect(screen.getByText('Rule #1')).toBeInTheDocument()
          expect(screen.getByText('Rule #5')).toBeInTheDocument()
          expect(screen.getByRole('button', { name: /add rule \(5\/5\)/i })).toBeDisabled()
        })

        it('preserves legacy grouped alerts with group controls intact', () => {
          const onChange = vi.fn()
          const groups: ConditionGroupConfig[] = [
            { id: 'g1', name: 'Group 1', logic: 'and' },
            { id: 'g2', name: 'Group 2', logic: 'or', connector: 'or' },
          ]
          const groupedConditions: SingleAlertCondition[] = [
            { ...sampleCondition1, groupId: 'g1' },
            { ...sampleCondition2, groupId: 'g2' },
          ]

          render(
            <MultiConditionEditor
              conditions={groupedConditions}
              logic="or"
              groups={groups}
              onChange={onChange}
            />
          )

          expect(screen.getByText(/Legacy Groups \(2 Groups\)/i)).toBeInTheDocument()
          expect(screen.getByText(/Legacy Multi-Condition Alert/i)).toBeInTheDocument()
          expect(screen.getByText(/2 Groups \(2 Rules\)/i)).toBeInTheDocument()
        })

        it('allows converting legacy alert to simplified V1 (keeping first 3 rules)', async () => {
          const user = userEvent.setup()
          const onChange = vi.fn()
          const fiveConditions: SingleAlertCondition[] = Array.from({ length: 5 }, (_, i) => ({
            id: `c_${i}`,
            timeframe: 'chart',
            left: { type: 'price', source: 'close' },
            operator: 'greaterThan',
            right: { type: 'value', value: 100 * (i + 1) },
          }))

          render(
            <MultiConditionEditor conditions={fiveConditions} logic="and" onChange={onChange} />
          )

          const convertBtn = screen.getByRole('button', {
            name: /convert to simplified v1 \(keep first 3 rules\)/i,
          })
          await user.click(convertBtn)

          expect(onChange).toHaveBeenCalledTimes(1)
          const converted = onChange.mock.calls[0]![0] as SingleAlertCondition[]
          expect(converted.length).toBe(3)
          expect(converted[0]!.id).toBe('c_0')
          expect(converted[1]!.id).toBe('c_1')
          expect(converted[2]!.id).toBe('c_2')
        })
      })

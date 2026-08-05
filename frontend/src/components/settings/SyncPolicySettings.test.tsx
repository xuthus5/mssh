import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SyncPolicySettings } from '@/components/settings/SyncPolicySettings'
import { SyncStrategy } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

describe('SyncPolicySettings', () => {
  it('shows labels instead of raw values in selects', async () => {
    const input = { strategy: SyncStrategy.SyncStrategySmart, interval_minutes: 0, retention_count: 20, retention_days: 30 }
    const onChange = vi.fn()
    render(<SyncPolicySettings input={input as never} pending={null} onChange={onChange} />)

    const strategy = screen.getByRole('combobox', { name: '同步策略' })
    expect(strategy.textContent).toContain('智能同步')
    expect(strategy.textContent).not.toContain('smart')

    const interval = screen.getByRole('combobox', { name: '自动同步间隔' })
    expect(interval.textContent).toContain('仅手动')
    expect(interval.textContent).not.toContain('0')

    const user = userEvent.setup()
    await user.click(interval)
    await user.click(await screen.findByRole('option', { name: '每 15 分钟' }))
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({ interval_minutes: 15 }))
  })
})

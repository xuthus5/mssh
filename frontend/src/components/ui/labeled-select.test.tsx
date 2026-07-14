import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { LabeledSelect } from '@/components/ui/labeled-select'

describe('LabeledSelect', () => {
  it('renders and updates labels without exposing option values', async () => {
    const user = userEvent.setup()
    const onValueChange = vi.fn()
    const { rerender } = render(
      <LabeledSelect
        value="folder-1"
        options={[
          { value: 'folder-1', label: '默认分组（默认）' },
          { value: 'folder-2', label: '生产环境' },
        ]}
        onValueChange={onValueChange}
      />,
    )
    const trigger = screen.getByRole('combobox')
    expect(within(trigger).getByText('默认分组（默认）')).toBeInTheDocument()
    expect(within(trigger).queryByText('folder-1')).not.toBeInTheDocument()

    await user.click(trigger)
    await user.click(await screen.findByRole('option', { name: '生产环境' }))
    expect(onValueChange).toHaveBeenCalledWith('folder-2')

    rerender(
      <LabeledSelect
        value="folder-2"
        options={[
          { value: 'folder-1', label: '默认分组（默认）' },
          { value: 'folder-2', label: '生产环境' },
        ]}
        onValueChange={onValueChange}
      />,
    )
    expect(within(trigger).getByText('生产环境')).toBeInTheDocument()
  })

  it('uses the placeholder for empty and unknown values', () => {
    const { rerender } = render(
      <LabeledSelect value="" options={[]} placeholder="请选择" onValueChange={vi.fn()} />,
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('请选择')

    rerender(
      <LabeledSelect value="missing" options={[]} placeholder="请选择" onValueChange={vi.fn()} />,
    )
    expect(screen.getByRole('combobox')).toHaveTextContent('请选择')
    expect(screen.getByRole('combobox')).not.toHaveTextContent('missing')
  })
})

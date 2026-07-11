import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { SearchableSelect } from '@/components/ui/searchable-select'

describe('SearchableSelect', () => {
  it('filters options and returns the selected label value', async () => {
    const onValueChange = vi.fn()
    render(<SearchableSelect value="Arial" options={['Arial', 'Microsoft YaHei', 'Segoe UI']} onValueChange={onValueChange} placeholder="搜索字体" />)

    const input = screen.getByRole('combobox')
    expect(input).toHaveValue('Arial')
    await userEvent.clear(input)
    await userEvent.type(input, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))

    expect(onValueChange).toHaveBeenCalledWith('Microsoft YaHei')
  })
})

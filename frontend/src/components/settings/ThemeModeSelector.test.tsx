import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { ThemeModeSelector } from '@/components/settings/ThemeModeSelector'

const profiles = [profile(1, 'GitHub Dark', 'dark'), profile(2, 'GitHub Light', 'light'), profile(3, 'Universal', 'universal')]

describe('ThemeModeSelector', () => {
  it('selects compatible and universal profiles by label', async () => {
    const onChange = vi.fn()
    render(<ThemeModeSelector mode="dark" profiles={profiles as never} value={1} onValueChange={onChange} />)
    const input = screen.getByRole('combobox', { name: 'Dark Mode 终端主题' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Universal')
    await userEvent.click(await screen.findByRole('option', { name: /Universal/ }))
    expect(onChange).toHaveBeenCalledWith(3)
  })

  it('only lists profiles compatible with the selected application mode', async () => {
    render(<ThemeModeSelector mode="dark" profiles={profiles as never} value={1} onValueChange={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: 'Dark Mode 终端主题' })
    await userEvent.clear(input)
    await userEvent.type(input, 'GitHub')

    expect(await screen.findByRole('option', { name: /GitHub Dark/ })).toBeInTheDocument()
    expect(screen.queryByRole('option', { name: /GitHub Light/ })).not.toBeInTheDocument()
  })

  it('keeps a 12 theme Dark catalog separate from a 12 theme Light catalog', async () => {
    const catalog = [
      ...Array.from({ length: 12 }, (_, index) => profile(index + 1, `Dark ${index + 1}`, 'dark')),
      ...Array.from({ length: 12 }, (_, index) => profile(index + 13, `Light ${index + 1}`, 'light')),
    ]
    render(<ThemeModeSelector mode="dark" profiles={catalog as never} value={1} onValueChange={vi.fn()} />)
    const input = screen.getByRole('combobox', { name: 'Dark Mode 终端主题' })
    await userEvent.clear(input)
    await userEvent.type(input, 'Dark')

    expect(await screen.findAllByRole('option')).toHaveLength(12)
    expect(screen.queryByText('Light 1')).not.toBeInTheDocument()
  })
})

function profile(id: number, name: string, mode: string) {
  return { id, name, definition: { id, name, mode, color_payload: '{}', source_type: 'builtin' } }
}

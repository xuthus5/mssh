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
})

function profile(id: number, name: string, mode: string) {
  return { id, name, definition: { id, name, mode, color_payload: '{}', source_type: 'builtin' } }
}

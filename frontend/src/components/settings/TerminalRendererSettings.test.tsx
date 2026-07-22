import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalRendererSettingsSection } from '@/components/settings/TerminalRendererSettings'

describe('TerminalRendererSettingsSection', () => {
  it('renders renderer options and emits selection changes', async () => {
    const onRendererChange = vi.fn()
    const user = userEvent.setup()
    render(
      <TerminalRendererSettingsSection renderer="dom" onRendererChange={onRendererChange} />,
    )
    expect(screen.getByText('渲染')).toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: '渲染器' }))
    await user.click(await screen.findByRole('option', { name: 'WebGL' }))
    expect(onRendererChange).toHaveBeenCalledWith('webgl')
  })
})

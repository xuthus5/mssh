import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import { TerminalRendererSettingsSection } from '@/components/settings/TerminalRendererSettings'
import { useThemeCatalogStore } from '@/hooks/useThemeCatalog'

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

  it('warns when a non-DOM renderer is selected with ligatures enabled', () => {
    useThemeCatalogStore.setState({ globalStyle: { ...useThemeCatalogStore.getState().globalStyle, ligatures_enabled: true } })
    render(<TerminalRendererSettingsSection renderer="webgl" onRendererChange={vi.fn()} />)
    expect(screen.getByText(/WebGL 渲染器下连字可能无法生效/)).toBeInTheDocument()
  })

  it('does not warn for the DOM renderer even with ligatures enabled', () => {
    useThemeCatalogStore.setState({ globalStyle: { ...useThemeCatalogStore.getState().globalStyle, ligatures_enabled: true } })
    render(<TerminalRendererSettingsSection renderer="dom" onRendererChange={vi.fn()} />)
    expect(screen.queryByText(/连字可能无法生效/)).not.toBeInTheDocument()
  })
})

import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import SettingsDialog from '@/components/settings/SettingsDialog'

const general = {
  maxPoolSize: 10,
  defaultKeepAlive: 60,
  defaultTermType: 'xterm-256color',
  uiFontFamily: 'Arial',
  uiFontFallbackFamily: 'Segoe UI',
  uiFontSize: 14,
}

function settingsProps() {
  return {
    open: true,
    onOpenChange: vi.fn(),
    general,
    systemFonts: ['Arial', 'Microsoft YaHei', 'Segoe UI'],
    theme: { background: '#000', foreground: '#fff', cursorColor: '#fff', cursorStyle: 'bar' as const, fontFamily: 'monospace', fontSize: 14, ansi: Array(16).fill('#000') },
    keys: [],
    sync: { enabled: false, url: '', username: '', password: '' },
    onSaveGeneral: vi.fn(async () => {}),
    onPreviewUIFont: vi.fn(),
    onRestoreUIFont: vi.fn(),
    onSaveTheme: vi.fn(),
    onGenerateKey: vi.fn(),
    onImportKey: vi.fn(),
    onDeleteKey: vi.fn(),
    onExportKey: vi.fn(async () => undefined),
    onSaveSync: vi.fn(),
    onExportConfig: vi.fn(),
    onImportConfig: vi.fn(),
    folders: [],
    sessions: [],
    onCreateFolder: vi.fn(async () => undefined),
    onRenameFolder: vi.fn(async () => {}),
    onSetDefaultFolder: vi.fn(async () => {}),
    onDeleteFolder: vi.fn(async () => {}),
  }
}

describe('SettingsDialog interface font settings', () => {
  it('previews and saves the selected font settings', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))
    await userEvent.clear(screen.getByLabelText('界面字号'))
    await userEvent.type(screen.getByLabelText('界面字号'), '18')

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Microsoft YaHei', 'Segoe UI', 18)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFamily: 'Microsoft YaHei', uiFontSize: 18 }))
  })

  it('previews and saves a distinct fallback font', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const fallbackInput = screen.getByRole('combobox', { name: 'Fallback 字体' })
    await userEvent.clear(fallbackInput)
    await userEvent.type(fallbackInput, 'YaHei')
    await userEvent.click(await screen.findByRole('option', { name: 'Microsoft YaHei' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Arial', 'Microsoft YaHei', 14)
    await userEvent.click(screen.getByRole('button', { name: '保存' }))
    expect(props.onSaveGeneral).toHaveBeenCalledWith(expect.objectContaining({ uiFontFallbackFamily: 'Microsoft YaHei' }))
  })

  it('resets fallback when the primary font selects the same family', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    const fontInput = screen.getByRole('combobox', { name: '界面字体' })
    await userEvent.clear(fontInput)
    await userEvent.type(fontInput, 'Segoe')
    await userEvent.click(await screen.findByRole('option', { name: 'Segoe UI' }))

    expect(props.onPreviewUIFont).toHaveBeenLastCalledWith('Segoe UI', 'sans-serif', 14)
  })

  it('restores persisted font settings when closing without saving', async () => {
    const props = settingsProps()
    render(<SettingsDialog {...props} />)

    await userEvent.clear(screen.getByLabelText('界面字号'))
    await userEvent.type(screen.getByLabelText('界面字号'), '20')
    await userEvent.keyboard('{Escape}')

    expect(props.onRestoreUIFont).toHaveBeenCalledOnce()
    expect(props.onOpenChange).toHaveBeenCalledWith(false)
  })
})

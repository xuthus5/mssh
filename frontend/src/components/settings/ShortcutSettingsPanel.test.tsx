import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { Events } from '@wailsio/runtime'
import { ShortcutSettingsPanel } from '@/components/settings/ShortcutSettingsPanel'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import { SHORTCUT_SETTING_KEY, defaultShortcutBindings, serializeShortcutBindings } from '@/lib/shortcuts'

describe('ShortcutSettingsPanel', () => {
  let saved: unknown

  afterEach(() => { vi.useRealTimers() })

  beforeEach(() => {
    __clearHandlers()
    saved = null
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Get', async (key: string) => {
      if (key !== SHORTCUT_SETTING_KEY) return null
      return {
        key,
        namespace: 'application',
        value: JSON.stringify(serializeShortcutBindings(defaultShortcutBindings())),
        value_type: 'object',
        version: 1,
        updated_at: '',
      }
    })
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async (setting: { value: string }) => {
      saved = JSON.parse(setting.value)
    })
  })

  it('renders shortcut actions and restores defaults', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    await waitFor(() => expect(screen.getByText('新建会话')).toBeInTheDocument())
    expect(screen.getByText('本地终端')).toBeInTheDocument()
    // mutate then restore to force persistence of defaults
    const recorders = screen.getAllByLabelText('录制快捷键')
    await user.click(recorders[0])
    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
    await waitFor(() => expect(saved).toEqual(expect.objectContaining({ 'new-session': 'Mod+Shift+S' })))
    saved = null
    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    await waitFor(() => expect(saved).toEqual(expect.objectContaining({ 'new-session': 'Mod+N' })))
  })

  it('records a new shortcut combination', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    await waitFor(() => expect(screen.getAllByLabelText('录制快捷键').length).toBeGreaterThan(0))
    const recorders = screen.getAllByLabelText('录制快捷键')
    await user.click(recorders[0])
    expect(screen.getByText('按下组合键…（Esc 取消）')).toBeInTheDocument()
    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
    await waitFor(() => expect(saved).toEqual(expect.objectContaining({ 'new-session': 'Mod+Shift+S' })))
  })

  it('cancels shortcut recording when the native settings window hides', async () => {
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    await waitFor(() => expect(screen.getAllByLabelText('录制快捷键').length).toBeGreaterThan(0))

    const recorder = screen.getAllByLabelText('录制快捷键')[0]
    await user.click(recorder)
    expect(screen.getByText('按下组合键…（Esc 取消）')).toBeInTheDocument()

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(screen.queryByText('按下组合键…（Esc 取消）')).not.toBeInTheDocument()
    expect(recorder).toHaveTextContent('Ctrl+N')
    saved = null
    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
    expect(saved).toBeNull()
  })

  it('persists restored defaults only once through autosave', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    const writes: unknown[] = []
    __registerHandler('github.com/xuthus5/mssh/internal/service.SettingService.Set', async (setting: { value: string }) => {
      writes.push(JSON.parse(setting.value))
    })
    const user = userEvent.setup()
    render(<ShortcutSettingsPanel />)
    await waitFor(() => expect(screen.getByText('新建会话')).toBeInTheDocument())

    await user.click(screen.getAllByLabelText('录制快捷键')[0])
    await user.keyboard('{Control>}{Shift>}s{/Shift}{/Control}')
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })
    expect(writes).toHaveLength(1)
    writes.length = 0

    await user.click(screen.getByRole('button', { name: '恢复默认' }))
    await act(async () => { await vi.advanceTimersByTimeAsync(500) })

    expect(writes).toHaveLength(1)
    expect(writes[0]).toEqual(expect.objectContaining({ 'new-session': 'Mod+N' }))
  })
})

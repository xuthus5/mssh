import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { ShortcutSettingsPanel } from '@/components/settings/ShortcutSettingsPanel'
import { SHORTCUT_SETTING_KEY, defaultShortcutBindings, serializeShortcutBindings } from '@/lib/shortcuts'

describe('ShortcutSettingsPanel', () => {
  let saved: unknown

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
})

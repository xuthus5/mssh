import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Events } from '@wailsio/runtime'
import { SyncPanel } from '@/components/settings/SyncPanel'
import { SETTINGS_PREVIEW_CANCELLED_EVENT } from '@/lib/settingsWindowEvents'
import { SyncProvider, SyncState, SyncStrategy } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

function controller(overrides: Record<string, unknown> = {}) {
  const dashboard = {
    config: { enabled: false, master_key_saved: true, provider: SyncProvider.SyncProviderGist, strategy: SyncStrategy.SyncStrategySmart, interval_minutes: 15, retention_count: 30, retention_days: 90, gist: { gist_id: '', token_saved: false }, webdav: { url: '', username: '', password_saved: false }, s3: { endpoint: '', region: 'us-east-1', bucket: '', prefix: '', access_key_id: '', secret_key_saved: false, path_style: false } },
    state: SyncState.SyncStateDisabled, message: '', last_synced_at: '', local_version: null, remote_version: null, conflict: null, versions: [], events: [],
  }
  return { dashboard, loading: false, pending: null, error: null, reload: vi.fn(async () => {}), saveConfig: vi.fn(async () => {}), testProvider: vi.fn(async () => {}), syncNow: vi.fn(async () => {}), pushNow: vi.fn(async () => {}), pullNow: vi.fn(async () => {}), resolveConflict: vi.fn(async () => {}), restoreVersion: vi.fn(async () => {}), deleteVersion: vi.fn(async () => {}), resetLocalData: vi.fn(async () => {}), ...overrides } as any
}

describe('SyncPanel', () => {
  beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })
  afterEach(() => { vi.runOnlyPendingTimers(); vi.useRealTimers() })

  it('reveals provider and status tabs after enabling sync', async () => {
    const sync = controller()
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    expect(screen.queryByRole('tab', { name: '云同步提供商' })).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    expect(screen.getByRole('tablist')).toHaveAttribute('data-orientation', 'horizontal')
    expect(screen.getByRole('tablist')).toHaveClass('flex-row')
    expect(screen.getByRole('tab', { name: '云同步提供商' })).toBeInTheDocument()
    expect(screen.getByRole('tab', { name: '同步状态与配置' })).toBeInTheDocument()
  })

  it('tests and saves selected provider credentials', async () => {
    const sync = controller()
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    await userEvent.click(screen.getByRole('button', { name: /WebDAV/ }))
    await userEvent.type(screen.getByLabelText('WebDAV URL'), 'https://dav.example/backups')
    await userEvent.click(screen.getByRole('button', { name: '测试连接' }))
    expect(sync.testProvider).toHaveBeenCalledWith(expect.objectContaining({ provider: SyncProvider.SyncProviderWebDAV, webdav: expect.objectContaining({ url: 'https://dav.example/backups' }) }))
    await vi.advanceTimersByTimeAsync(700)
    expect(sync.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: SyncProvider.SyncProviderWebDAV,
      webdav: expect.objectContaining({ url: 'https://dav.example/backups' }),
    }), { quiet: true })
  })

  it('keeps every provider credential input masked', async () => {
    const sync = controller()
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    expect(screen.getByLabelText('GitHub Token')).toHaveAttribute('type', 'password')

    await userEvent.click(screen.getByRole('button', { name: /WebDAV/ }))
    expect(screen.getByLabelText('密码')).toHaveAttribute('type', 'password')

    await userEvent.click(screen.getByRole('button', { name: /^S3/ }))
    expect(screen.getByLabelText('Secret Access Key')).toHaveAttribute('type', 'password')
  })

  it('keeps unsaved provider edits when a stale dashboard refresh arrives', async () => {
    const sync = controller()
    const view = render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    await userEvent.click(screen.getByRole('button', { name: /WebDAV/ }))
    await userEvent.type(screen.getByLabelText('WebDAV URL'), 'https://draft.example/backups')

    const refreshed = {
      ...sync,
      dashboard: { ...sync.dashboard, message: 'background refresh' },
    }
    view.rerender(<SyncPanel controller={refreshed} onExport={vi.fn()} onImport={vi.fn()} />)

    expect(screen.getByRole('switch', { name: '启用云同步' })).toBeChecked()
    expect(screen.getByLabelText('WebDAV URL')).toHaveValue('https://draft.example/backups')
  })

  it('pauses config autosave during provider tests and resumes afterward', async () => {
    const sync = controller()
    const view = render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    await userEvent.click(screen.getByRole('button', { name: /WebDAV/ }))
    await userEvent.type(screen.getByLabelText('WebDAV URL'), 'https://draft.example/backups')

    view.rerender(<SyncPanel controller={{ ...sync, pending: 'test' }} onExport={vi.fn()} onImport={vi.fn()} />)
    await vi.advanceTimersByTimeAsync(700)
    expect(sync.saveConfig).not.toHaveBeenCalled()

    view.rerender(<SyncPanel controller={{ ...sync, pending: null }} onExport={vi.fn()} onImport={vi.fn()} />)
    await vi.advanceTimersByTimeAsync(700)
    expect(sync.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      provider: SyncProvider.SyncProviderWebDAV,
      webdav: expect.objectContaining({ url: 'https://draft.example/backups' }),
    }), { quiet: true })
  })

  it('clears a saved Gist token without writing it twice', async () => {
    const save = deferred<void>()
    const sync = controller({ saveConfig: vi.fn(() => save.promise) })
    const view = render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    await userEvent.type(screen.getByLabelText('GitHub Token'), 'gist-secret')
    await vi.advanceTimersByTimeAsync(500)
    expect(sync.saveConfig).toHaveBeenCalledOnce()

    const persisted = {
      ...sync,
      dashboard: {
        ...sync.dashboard,
        config: {
          ...sync.dashboard.config,
          enabled: true,
          gist: { ...sync.dashboard.config.gist, token_saved: true },
        },
      },
    }
    view.rerender(<SyncPanel controller={persisted} onExport={vi.fn()} onImport={vi.fn()} />)
    await act(async () => { save.resolve(undefined); await save.promise; await Promise.resolve() })

    expect(screen.getByLabelText('GitHub Token')).toHaveValue('')
    await vi.advanceTimersByTimeAsync(700)
    expect(sync.saveConfig).toHaveBeenCalledOnce()
  })

  it('redacts pending provider credentials when the native settings window hides without writing them twice', async () => {
    const save = deferred<void>()
    const sync = controller({ saveConfig: vi.fn(() => save.promise) })
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    await userEvent.type(screen.getByLabelText('GitHub Token'), 'gist-secret')

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(sync.saveConfig).toHaveBeenCalledOnce()
    expect(sync.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      enabled: true,
      gist: expect.objectContaining({ token: 'gist-secret' }),
    }), { quiet: true })
    expect(screen.getByLabelText('GitHub Token')).toHaveValue('')
    await act(async () => { save.resolve(undefined); await save.promise; await Promise.resolve() })
    await vi.advanceTimersByTimeAsync(700)
    expect(sync.saveConfig).toHaveBeenCalledOnce()
  })

  it.each([
    { provider: /WebDAV/, label: '密码', secret: 'webdav-secret', field: 'webdav', key: 'password' },
    { provider: /^S3/, label: 'Secret Access Key', secret: 's3-secret', field: 's3', key: 'secret_key' },
  ])('redacts pending $field credentials on settings hide', async ({ provider, label, secret, field, key }) => {
    const save = deferred<void>()
    const sync = controller({ saveConfig: vi.fn(() => save.promise) })
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('switch', { name: '启用云同步' }))
    await userEvent.click(screen.getByRole('button', { name: provider }))
    await userEvent.type(screen.getByLabelText(label), secret)

    await act(async () => { await Events.Emit(SETTINGS_PREVIEW_CANCELLED_EVENT, { data: null }) })

    expect(sync.saveConfig).toHaveBeenCalledWith(expect.objectContaining({
      [field]: expect.objectContaining({ [key]: secret }),
    }), { quiet: true })
    expect(screen.getByLabelText(label)).toHaveValue('')
    await act(async () => { save.resolve(undefined); await save.promise; await Promise.resolve() })
    await vi.advanceTimersByTimeAsync(700)
    expect(sync.saveConfig).toHaveBeenCalledOnce()
  })

  it('shows status controls and local reset action', async () => {
    const sync = controller({ dashboard: { ...controller().dashboard, config: { ...controller().dashboard.config, enabled: true }, state: SyncState.SyncStateSynced } })
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '同步状态与配置' }))
    expect(screen.getByText('本地版本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空本地业务数据' })).toBeInTheDocument()
  })

  it('shows export/import header failures as panel banner without toast', async () => {
    const onExport = vi.fn(async () => { throw new Error('export boom') })
    const onImport = vi.fn(async () => { throw new Error('import boom') })
    render(<SyncPanel controller={controller()} onExport={onExport} onImport={onImport} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导出本地备份失败: export boom')
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导入本地备份失败: import boom')
    expect(onExport).toHaveBeenCalled()
    expect(onImport).toHaveBeenCalled()
  })

  it('shows a retryable banner when the dashboard cannot be loaded', async () => {
    const reload = vi.fn(async () => {})
    render(<SyncPanel controller={controller({ dashboard: null, loading: false, error: 'network failed', reload })} onExport={vi.fn()} onImport={vi.fn()} />)

    expect(screen.getByRole('alert')).toHaveTextContent('network failed')
    await userEvent.click(screen.getByRole('button', { name: '重试' }))
    expect(reload).toHaveBeenCalledOnce()
  })

  it('shows export/import danger-action failures as panel banner', async () => {
    const onExport = vi.fn(async () => { throw new Error('export boom') })
    const onImport = vi.fn(async () => { throw new Error('import boom') })
    const sync = controller({ dashboard: { ...controller().dashboard, config: { ...controller().dashboard.config, enabled: true }, state: SyncState.SyncStateSynced } })
    render(<SyncPanel controller={sync} onExport={onExport} onImport={onImport} />)
    await userEvent.click(screen.getByRole('tab', { name: '同步状态与配置' }))
    await userEvent.click(screen.getByRole('button', { name: '导出本地备份' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导出本地备份失败: export boom')
    await userEvent.click(screen.getByRole('button', { name: '导入本地备份' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('导入本地备份失败: import boom')
    expect(onExport).toHaveBeenCalled()
    expect(onImport).toHaveBeenCalled()
  })

  it('allows only one backup transfer at a time', async () => {
    let resolveExport: (() => void) | undefined
    const onExport = vi.fn(() => new Promise<void>((resolve) => { resolveExport = resolve }))
    const onImport = vi.fn(async () => {})
    render(<SyncPanel controller={controller()} onExport={onExport} onImport={onImport} />)

    const exportButton = screen.getByRole('button', { name: '导出' })
    const importButton = screen.getByRole('button', { name: '导入' })
    await userEvent.click(exportButton)
    expect(exportButton).toBeDisabled()
    expect(importButton).toBeDisabled()
    await userEvent.click(importButton)
    expect(onExport).toHaveBeenCalledOnce()
    expect(onImport).not.toHaveBeenCalled()

    await act(async () => { resolveExport?.() })
    expect(exportButton).toBeEnabled()
  })
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

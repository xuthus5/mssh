import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { SyncPanel } from '@/components/settings/SyncPanel'
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

  it('shows status controls and local reset action', async () => {
    const sync = controller({ dashboard: { ...controller().dashboard, config: { ...controller().dashboard.config, enabled: true }, state: SyncState.SyncStateSynced } })
    render(<SyncPanel controller={sync} onExport={vi.fn()} onImport={vi.fn()} />)
    await userEvent.click(screen.getByRole('tab', { name: '同步状态与配置' }))
    expect(screen.getByText('本地版本')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '清空本地业务数据' })).toBeInTheDocument()
  })

  it('swallows export/import promise rejections from header actions', async () => {
    const onExport = vi.fn(async () => { throw new Error('export boom') })
    const onImport = vi.fn(async () => { throw new Error('import boom') })
    render(<SyncPanel controller={controller()} onExport={onExport} onImport={onImport} />)
    await userEvent.click(screen.getByRole('button', { name: '导出' }))
    await userEvent.click(screen.getByRole('button', { name: '导入' }))
    expect(onExport).toHaveBeenCalled()
    expect(onImport).toHaveBeenCalled()
  })

  it('swallows export/import promise rejections from danger actions', async () => {
    const onExport = vi.fn(async () => { throw new Error('export boom') })
    const onImport = vi.fn(async () => { throw new Error('import boom') })
    const sync = controller({ dashboard: { ...controller().dashboard, config: { ...controller().dashboard.config, enabled: true }, state: SyncState.SyncStateSynced } })
    render(<SyncPanel controller={sync} onExport={onExport} onImport={onImport} />)
    await userEvent.click(screen.getByRole('tab', { name: '同步状态与配置' }))
    await userEvent.click(screen.getByRole('button', { name: '导出本地备份' }))
    await userEvent.click(screen.getByRole('button', { name: '导入本地备份' }))
    expect(onExport).toHaveBeenCalled()
    expect(onImport).toHaveBeenCalled()
  })
})

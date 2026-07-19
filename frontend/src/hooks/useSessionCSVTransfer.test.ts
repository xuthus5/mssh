import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useSessionCSVTransfer } from '@/hooks/useSessionCSVTransfer'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { SessionCSVConflictPolicy } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

const service = 'github.com/xuthus5/mssh/internal/service.SessionService.'

describe('useSessionCSVTransfer', () => {
  beforeEach(() => __clearHandlers())

  it('exports selected sessions with explicit password option', async () => {
    const handler = vi.fn(async () => ({ count: 2, included_passwords: true }))
    __registerHandler(service + 'ExportCSV', handler)
    const refreshFolders = vi.fn(async () => {})
    const refreshAssets = vi.fn(async () => {})
    const { result } = renderHook(() => useSessionCSVTransfer({ refreshFolders, refreshAssets }))

    await act(async () => {
      expect(await result.current.exportSessionsCSV({ path: '/tmp/sessions.csv', sessionIDs: ['3', '5'], includePasswords: true })).toEqual(expect.objectContaining({ count: 2 }))
    })

    expect(handler).toHaveBeenCalledWith('/tmp/sessions.csv', { session_ids: [3, 5], include_passwords: true })
    expect(refreshFolders).not.toHaveBeenCalled()
  })

  it('imports sessions and refreshes folders and assets', async () => {
    const summary = { total: 1, imported: 1, updated: 0, skipped: 0, failed: 0, results: [] }
    const handler = vi.fn(async () => summary)
    __registerHandler(service + 'ImportCSV', handler)
    const refreshFolders = vi.fn(async () => {})
    const refreshAssets = vi.fn(async () => {})
    const { result } = renderHook(() => useSessionCSVTransfer({ refreshFolders, refreshAssets }))

    await act(async () => {
      expect(await result.current.importSessionsCSV({
        path: '/tmp/sessions.csv',
        conflictPolicy: SessionCSVConflictPolicy.SessionCSVConflictOverwrite,
        headerMapping: { name: 'Session' },
        defaultValues: { port: '22' },
      })).toEqual(expect.objectContaining({ imported: 1 }))
    })

    expect(handler).toHaveBeenCalledWith('/tmp/sessions.csv', {
      conflict_policy: 'overwrite', header_mapping: { name: 'Session' }, default_values: { port: '22' },
    })
    expect(refreshFolders).toHaveBeenCalledOnce()
    expect(refreshAssets).toHaveBeenCalledOnce()
  })

  it('previews external csv headers without refreshing workspace data', async () => {
    const preview = { headers: ['Session', 'Host'], sample_rows: [['server', '10.0.0.1']], total_rows: 1 }
    const handler = vi.fn(async () => preview)
    __registerHandler(service + 'PreviewCSV', handler)
    const refreshFolders = vi.fn(async () => {})
    const refreshAssets = vi.fn(async () => {})
    const { result } = renderHook(() => useSessionCSVTransfer({ refreshFolders, refreshAssets }))

    await act(async () => {
      expect(await result.current.previewSessionsCSV('/tmp/external.csv')).toEqual(expect.objectContaining({ total_rows: 1 }))
    })

    expect(handler).toHaveBeenCalledWith('/tmp/external.csv')
    expect(refreshFolders).not.toHaveBeenCalled()
    expect(refreshAssets).not.toHaveBeenCalled()
  })
})

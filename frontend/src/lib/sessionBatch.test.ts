import { beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  DeleteSessions: vi.fn(),
  RecordBatch: vi.fn(),
}))

vi.mock('@/lib/wails', () => ({
  AuditService: { RecordBatch: mocks.RecordBatch },
  MacroService: {},
  SessionService: { DeleteSessions: mocks.DeleteSessions },
  TerminalService: {},
}))

vi.mock('@/lib/logger', () => ({
  logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() },
}))

import { runBatchDeleteSessions } from '@/lib/sessionBatch'

describe('runBatchDeleteSessions', () => {
  beforeEach(() => {
    mocks.DeleteSessions.mockReset()
    mocks.RecordBatch.mockReset()
  })

  it('deletes all selected sessions and records success audit', async () => {
    mocks.DeleteSessions.mockResolvedValue(2)
    mocks.RecordBatch.mockResolvedValue(undefined)
    const results = await runBatchDeleteSessions([
      { id: '1', name: 'one' },
      { id: '2', name: 'two' },
    ])
    expect(mocks.DeleteSessions).toHaveBeenCalledWith([1, 2])
    expect(results).toEqual([
      { sessionId: '1', name: 'one', success: true },
      { sessionId: '2', name: 'two', success: true },
    ])
    expect(mocks.RecordBatch).toHaveBeenCalledWith('batch_delete', [1, 2], ['success', 'success'])
  })

  it('marks every session failed when backend delete fails', async () => {
    mocks.DeleteSessions.mockRejectedValue(new Error('fk constraint'))
    mocks.RecordBatch.mockResolvedValue(undefined)
    const results = await runBatchDeleteSessions([
      { id: '1', name: 'one' },
      { id: '2', name: 'two' },
    ])
    expect(results).toEqual([
      { sessionId: '1', name: 'one', success: false, error: 'fk constraint' },
      { sessionId: '2', name: 'two', success: false, error: 'fk constraint' },
    ])
    expect(mocks.RecordBatch).toHaveBeenCalledWith('batch_delete', [1, 2], ['failed', 'failed'])
  })
})

import { describe, expect, it } from 'vitest'
import { aggregateTransferProgress, partitionTransfers } from '@/lib/transferMetrics'
import type { TransferJob } from '@/store/appStore'

const job = (overrides: Partial<TransferJob>): TransferJob => ({
  id: 'task', fileName: 'archive.tar.gz', direction: 'upload', sessionId: 1, sessionName: '生产服务器', sourcePath: '/local/archive.tar.gz', targetPath: '/remote/archive.tar.gz', totalBytes: 100, transferredBytes: 0, speed: 0, eta: 0, status: 'queued', startedAt: 1, ...overrides,
})

describe('transferMetrics', () => {
  it('partitions active and recent transfers by status and recency', () => {
    const result = partitionTransfers([
      job({ id: 'done', status: 'completed', completedAt: 20 }),
      job({ id: 'running', status: 'running', startedAt: 30 }),
      job({ id: 'failed', status: 'failed', completedAt: 40 }),
    ])

    expect(result.active.map((item) => item.id)).toEqual(['running'])
    expect(result.recent.map((item) => item.id)).toEqual(['failed', 'done'])
  })

  it('calculates byte-weighted progress for known transfer sizes', () => {
    expect(aggregateTransferProgress([
      job({ id: 'small', totalBytes: 100, transferredBytes: 100, status: 'running' }),
      job({ id: 'large', totalBytes: 300, transferredBytes: 100, status: 'running' }),
    ])).toEqual({ activeCount: 2, percentage: 50, hasUnknownSize: false })
  })

  it('does not report a misleading percentage when a size is unknown', () => {
    expect(aggregateTransferProgress([
      job({ id: 'known', status: 'running' }),
      job({ id: 'unknown', totalBytes: 0, status: 'queued' }),
    ])).toEqual({ activeCount: 2, percentage: null, hasUnknownSize: true })
  })
})

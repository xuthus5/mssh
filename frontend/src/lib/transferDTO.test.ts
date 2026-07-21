import { describe, expect, it } from 'vitest'
import { mapBackendTransferJob, mapBackendTransferJobs } from '@/lib/transferDTO'

describe('transferDTO', () => {
  it('maps a valid backend transfer job', () => {
    const job = mapBackendTransferJob({
      id: 't1', session_id: 3, session_name: 'prod', direction: 'upload',
      source_path: '/tmp/a.txt', target_path: '/a.txt', total_bytes: 10, transferred_bytes: 4,
      speed: 1, eta: 2, status: 'running', error: '', started_at: '2026-07-17T00:00:00Z',
    })
    expect(job).toMatchObject({ id: 't1', fileName: 'a.txt', sessionId: 3, status: 'running', transferredBytes: 4 })
  })

  it('collects mapping errors without throwing the whole batch', () => {
    const result = mapBackendTransferJobs([
      { id: 'ok', session_id: 1, session_name: 's', direction: 'download', source_path: '/a', target_path: '/b', total_bytes: 1, transferred_bytes: 1, speed: 0, eta: 0, status: 'completed', started_at: '2026-07-17T00:00:00Z' },
      { id: 'bad', direction: 'sideways' },
    ])
    expect(result.jobs).toHaveLength(1)
    expect(result.errors[0]).toContain('index 1')
  })
})

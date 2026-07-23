import { describe, expect, it } from 'vitest'
import {
  getConfirmDialogSnapshot,
  requestConfirm,
  resolveConfirmDialog,
  subscribeConfirmDialog,
} from '@/lib/confirmDialog'

describe('confirmDialog', () => {
  it('resolves true/false through the shared request channel', async () => {
    const events: Array<string | null> = []
    const stop = subscribeConfirmDialog(() => {
      events.push(getConfirmDialogSnapshot()?.title ?? null)
    })
    const pending = requestConfirm({ title: '关闭标签？', description: '不可撤销' })
    expect(getConfirmDialogSnapshot()?.title).toBe('关闭标签？')
    resolveConfirmDialog(true)
    await expect(pending).resolves.toBe(true)
    expect(getConfirmDialogSnapshot()).toBeNull()
    stop()
    expect(events.includes('关闭标签？')).toBe(true)
    expect(events.includes(null)).toBe(true)
  })

  it('cancels a previous pending request when a new one arrives', async () => {
    const stop = subscribeConfirmDialog(() => {})
    const first = requestConfirm({ title: 'first' })
    const second = requestConfirm({ title: 'second' })
    resolveConfirmDialog(true)
    await expect(first).resolves.toBe(false)
    await expect(second).resolves.toBe(true)
    stop()
  })

  it('fails closed immediately when no dialog host is subscribed', async () => {
    await expect(requestConfirm({ title: 'orphan' })).resolves.toBe(false)
    expect(getConfirmDialogSnapshot()).toBeNull()
  })
})

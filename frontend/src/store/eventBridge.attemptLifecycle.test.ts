import { waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { __clearHandlers, __emitEvent, __registerHandler } from '@/test/__mocks__/wails-runtime'
import { startEventBridge } from '@/store/eventBridge'
import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

const sessionService = 'github.com/xuthus5/mssh/internal/service.SessionService.'
let stopBridge: (() => void) | undefined

function emitFingerprint(attemptId: string) {
  __emitEvent('session:fingerprint', { data: {
    attempt_id: attemptId, hostname: `${attemptId}.internal:22`,
    fingerprint: `SHA256:${attemptId}`, algorithm: 'ssh-ed25519',
  } })
}

describe('eventBridge connection attempt lifecycle', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler('github.com/xuthus5/mssh/internal/service.FileService.ListTransfers', async () => [])
    __registerHandler(sessionService + 'DecideHostKey', vi.fn(async () => {}))
    __registerHandler(sessionService + 'CancelConnect', vi.fn(async () => {}))
    useHostKeyPromptDialog.setState({ active: null, pending: false, error: '' })
    stopBridge = startEventBridge()
  })

  afterEach(() => {
    stopBridge?.()
    stopBridge = undefined
  })

  it('clears a finished active attempt and displays the next live fingerprint', async () => {
    emitFingerprint('first')
    emitFingerprint('second')

    __emitEvent('session:attempt', { data: { attempt_id: 'first', state: 'finished' } })

    await waitFor(() => expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('second'))
  })

  it('removes finished queued attempts without dismissing an unrelated active prompt', async () => {
    emitFingerprint('first')
    emitFingerprint('second')
    emitFingerprint('third')
    __emitEvent('session:attempt', { data: { attempt_id: 'second', state: 'finished' } })
    __emitEvent('session:attempt', { data: { attempt_id: 'unrelated', state: 'finished' } })
    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('first')

    await useHostKeyPromptDialog.getState().decide(true)

    await waitFor(() => expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('third'))
  })

  it('ignores a fingerprint delivered after its completion event', () => {
    __emitEvent('session:attempt', { data: { attempt_id: 'finished', state: 'finished' } })

    emitFingerprint('finished')

    expect(useHostKeyPromptDialog.getState().active).toBeNull()
  })

  it('ignores incomplete events and states other than finished', () => {
    emitFingerprint('active')
    __emitEvent('session:attempt', {})
    __emitEvent('session:attempt', { data: {} })
    __emitEvent('session:attempt', { data: { state: 'finished' } })
    __emitEvent('session:attempt', { data: { attempt_id: 'active' } })
    for (const state of ['connecting', 'connected', 'failed']) {
      __emitEvent('session:attempt', { data: { attempt_id: 'active', state } })
    }

    expect(useHostKeyPromptDialog.getState().active?.prompt.attemptId).toBe('active')
  })
})

import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useConnectDialog } from '@/store/connectDialog'

const jumpHost = { host: 'bastion.internal', port: 2222, username: 'deploy', authMethod: 'password' as const, password: 'secret' }

function openJumpConnection() {
  const dialogId = useConnectDialog.getState().openDialog('target.internal', 22, 'root', vi.fn(), '5')
  const requestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
  return { dialogId, requestId }
}

beforeEach(() => useConnectDialog.setState(useConnectDialog.getInitialState()))

describe('connection dialog jump progress ownership', () => {
  it('stores only jump endpoint details and starts at the jump stage', () => {
    const { dialogId, requestId } = openJumpConnection()
    expect(requestId).toBeTruthy()
    expect(useConnectDialog.getState()).toMatchObject({
      dialogId, requestId, stage: 'jump', attemptId: '',
      jumpHost: { host: 'bastion.internal', port: 2222, username: 'deploy' },
    })
    expect(useConnectDialog.getState().jumpHost).not.toHaveProperty('password')
    expect(useConnectDialog.getState().jumpHost).not.toHaveProperty('authMethod')
  })

  it('accepts only matching request progress and never regresses from target to jump', () => {
    const { requestId } = openJumpConnection()
    const dialog = useConnectDialog.getState()
    dialog.reportProgress({ requestId: 'background-request', attemptId: 'background', stage: 'target' })
    expect(useConnectDialog.getState()).toMatchObject({ stage: 'jump', attemptId: '' })
    dialog.reportProgress({ requestId, attemptId: 'jump-attempt', stage: 'jump' })
    expect(useConnectDialog.getState()).toMatchObject({ stage: 'jump', attemptId: 'jump-attempt' })
    dialog.reportProgress({ requestId, attemptId: 'target-attempt', stage: 'target' })
    dialog.reportProgress({ requestId, attemptId: 'jump-attempt', stage: 'jump' })
    expect(useConnectDialog.getState()).toMatchObject({ stage: 'target', attemptId: 'target-attempt' })
  })

  it('retires a retried request and ignores its late progress', () => {
    const { dialogId, requestId: oldRequest } = openJumpConnection()
    useConnectDialog.getState().reportProgress({ requestId: oldRequest, attemptId: 'old-target', stage: 'target' })
    const requestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
    expect(requestId).not.toBe(oldRequest)
    expect(useConnectDialog.getState().isRetiredRequest(oldRequest)).toBe(true)
    useConnectDialog.getState().reportProgress({ requestId: oldRequest, attemptId: 'late', stage: 'target' })
    expect(useConnectDialog.getState()).toMatchObject({ requestId, stage: 'jump', attemptId: '' })
    expect(useConnectDialog.getState().isRetiredRequest('unknown-background-request')).toBe(false)
  })

  it('resets jump metadata when another direct connection replaces the dialog', () => {
    const { requestId } = openJumpConnection()
    useConnectDialog.getState().openDialog('direct.internal', 22, 'admin', vi.fn())
    expect(useConnectDialog.getState()).toMatchObject({ requestId: '', jumpHost: null, stage: 'target', attemptId: '' })
    expect(useConnectDialog.getState().isRetiredRequest(requestId)).toBe(true)
  })

  it.each(['close', 'cancel'])('retires an explicitly %sd connection', async (action) => {
    const { dialogId, requestId } = openJumpConnection()
    if (action === 'cancel') await useConnectDialog.getState().cancelConnection()
    else useConnectDialog.getState().closeDialog(dialogId)
    expect(useConnectDialog.getState().isRetiredRequest(requestId)).toBe(true)
    useConnectDialog.getState().reportProgress({ requestId, attemptId: 'late', stage: 'target' })
    expect(useConnectDialog.getState()).toMatchObject({ open: false, requestId: '', jumpHost: null, stage: 'target' })
  })

  it('does not let an old dialog or completed request mutate the current progress', () => {
    const { dialogId, requestId } = openJumpConnection()
    useConnectDialog.getState().completeDialog(dialogId)
    useConnectDialog.getState().reportProgress({ requestId, attemptId: 'late-target', stage: 'target' })
    expect(useConnectDialog.getState()).toMatchObject({ state: 'connected', stage: 'jump', attemptId: '' })
    useConnectDialog.getState().closeDialog(dialogId)
    expect(useConnectDialog.getState().isRetiredRequest(requestId)).toBe(false)
    const currentId = useConnectDialog.getState().openDialog('next.internal', 22, 'root', vi.fn())
    const detachedRequestId = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
    expect(detachedRequestId).toBeTruthy()
    expect(useConnectDialog.getState()).toMatchObject({ dialogId: currentId, requestId: '', jumpHost: null })
  })

  it('bounds retired requests without classifying unknown background traffic as stale', () => {
    const { dialogId, requestId: first } = openJumpConnection()
    let last = first
    for (let index = 0; index < 257; index++) last = useConnectDialog.getState().beginConnectionAttempt(dialogId, jumpHost)
    useConnectDialog.getState().closeDialog(dialogId)
    expect(useConnectDialog.getState().isRetiredRequest(first)).toBe(false)
    expect(useConnectDialog.getState().isRetiredRequest(last)).toBe(true)
    expect(useConnectDialog.getState().isRetiredRequest()).toBe(false)
  })
})

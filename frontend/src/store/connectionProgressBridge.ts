import { SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { useConnectDialog } from '@/store/connectDialog'
import type { createHostKeyPromptCoordinator } from '@/store/hostKeyPromptCoordinator'
import { subscribeRetiredConnectionRequests } from '@/store/connectionRequestRegistry'

export interface ConnectionProgressPayload { request_id?: string; attempt_id?: string; stage?: string }
export interface FingerprintPayload {
  attempt_id?: string; request_id?: string; is_jump_host?: boolean; uses_jump_host?: boolean
  hostname?: string; fingerprint?: string; algorithm?: string; changed?: boolean; expected?: string[]
}

type HostKeyCoordinator = ReturnType<typeof createHostKeyPromptCoordinator>
const MAX_TRACKED_PROMPTS = 256

export function createConnectionProgressBridge(coordinator: HostKeyCoordinator) {
  const tracked = new Map<string, string>()
  const finish = (attemptId: string) => { tracked.delete(attemptId); coordinator.finish(attemptId) }
  const reject = (attemptId: string) => { finish(attemptId); void rejectRetiredFingerprint(attemptId) }
  const unsubscribe = subscribeRetiredConnectionRequests((retiredRequestId) => {
    for (const [attemptId, requestId] of tracked) {
      if (requestId === retiredRequestId) reject(attemptId)
    }
  })
  return {
    finish,
    progress: reportConnectionProgress,
    fingerprint: (payload?: FingerprintPayload) => handleFingerprint({ coordinator, tracked, reject }, payload),
    stop: () => { unsubscribe(); tracked.clear() },
  }
}

function reportConnectionProgress(payload?: ConnectionProgressPayload) {
  if (!payload?.request_id || !payload.attempt_id) return
  if (payload.stage !== 'jump' && payload.stage !== 'target') return
  useConnectDialog.getState().reportProgress({ requestId: payload.request_id, attemptId: payload.attempt_id, stage: payload.stage })
}

function handleFingerprint(context: {
  coordinator: HostKeyCoordinator; tracked: Map<string, string>; reject: (attemptId: string) => void
}, payload?: FingerprintPayload) {
  if (!payload?.attempt_id) return
  const dialog = useConnectDialog.getState()
  if (dialog.isRetiredRequest(payload.request_id)) { context.reject(payload.attempt_id); return }
  if (payload.request_id) trackPrompt(context.tracked, payload)
  reportConnectionProgress({ ...payload, stage: payload.is_jump_host ? 'jump' : 'target' })
  context.coordinator.handle({
    attemptId: payload.attempt_id, requestId: payload.request_id, isJumpHost: payload.is_jump_host === true,
    usesJumpHost: payload.uses_jump_host,
    hostname: payload.hostname ?? '', fingerprint: payload.fingerprint ?? '', algorithm: payload.algorithm ?? '',
    changed: payload.changed === true, expected: payload.expected ?? [],
  })
}

function trackPrompt(tracked: Map<string, string>, payload: FingerprintPayload) {
  tracked.set(payload.attempt_id!, payload.request_id!)
  if (tracked.size <= MAX_TRACKED_PROMPTS) return
  const oldest = tracked.keys().next().value
  if (oldest) tracked.delete(oldest)
}

async function rejectRetiredFingerprint(attemptId: string) {
  try {
    await SessionService.DecideHostKey(attemptId, false)
  } catch (decisionError: unknown) {
    try {
      await SessionService.CancelConnect(attemptId)
    } catch (cancelError: unknown) {
      logger.error('cancel retired host key attempt failed', { attemptId, decisionError, cancelError })
    }
  }
}

import { useHostKeyPromptDialog } from '@/store/hostKeyPromptDialog'

interface ReconnectTimeoutOptions {
  durationMs: number
  waitForFingerprint: boolean
  targetTabId?: string | null
  onTimeout: () => void
}

/** 指纹确认占用交互时暂停 SSH 的前端兜底计时，后端仍独立限制网络 I/O。 */
export function startReconnectAttemptTimeout(options: ReconnectTimeoutOptions) {
  let remainingMs = options.durationMs
  let startedAt = 0
  let timer: number | undefined
  let stopped = false
  const pause = () => {
    if (timer === undefined) return
    window.clearTimeout(timer)
    timer = undefined
    remainingMs = Math.max(0, remainingMs - (performance.now() - startedAt))
  }
  const sync = () => {
    if (stopped) return
    if (options.waitForFingerprint && hasPendingFingerprintPrompt(options.targetTabId)) return pause()
    if (timer !== undefined) return
    startedAt = performance.now()
    timer = window.setTimeout(() => {
      timer = undefined
      stop()
      options.onTimeout()
    }, remainingMs)
  }
  const unsubscribe = useHostKeyPromptDialog.subscribe(sync)
  const stop = () => {
    if (stopped) return
    stopped = true
    pause()
    unsubscribe()
  }
  sync()
  return stop
}

/** 活动弹框，或本页签排队等待的弹框，都会让重连尝试保持等待。 */
function hasPendingFingerprintPrompt(targetTabId?: string | null) {
  const state = useHostKeyPromptDialog.getState()
  if (state.active) return true
  if (!targetTabId) return false
  return state.deferred.some((item) => item.prompt.targetTabId === targetTabId)
}

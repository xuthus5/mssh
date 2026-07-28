import { logger } from '@/lib/logger'
import { SessionService } from '@/lib/wails'
import {
  useHostKeyPromptDialog,
  type HostKeyEndpoint,
  type HostKeyPrompt,
} from '@/store/hostKeyPromptDialog'

const MAX_PENDING_HOST_KEY_PROMPTS = 32
let nextCoordinatorId = 1

class HostKeyPromptCoordinator {
  private readonly coordinatorId = nextCoordinatorId++
  private readonly pending: HostKeyPrompt[] = []
  private readonly unsubscribe: () => void
  private stopped = false
  private pumpScheduled = false

  constructor() {
    this.unsubscribe = useHostKeyPromptDialog.subscribe((state, previous) => {
      if (previous.active && !state.active) this.schedulePump()
    })
  }

  handle(prompt: HostKeyPrompt) {
    if (this.stopped) return
    if (!isValidPrompt(prompt)) return this.rejectPrompt(prompt, 'invalid host key prompt')
    const active = useHostKeyPromptDialog.getState().active
    if (active?.prompt.attemptId === prompt.attemptId || this.hasPending(prompt.attemptId)) return
    const endpoint = parseHostKeyEndpoint(prompt.hostname)
    if (!endpoint) return this.rejectPrompt(prompt, 'invalid host key prompt endpoint')
    if (!active) return this.showPrompt(prompt, endpoint)
    if (this.pending.length >= MAX_PENDING_HOST_KEY_PROMPTS) {
      this.rejectPrompt(prompt, 'host key prompt queue full')
      return
    }
    this.pending.push(prompt)
  }

  stop() {
    if (this.stopped) return
    this.stopped = true
    this.unsubscribe()
    const active = useHostKeyPromptDialog.getState().active
    const prompts = active?.coordinatorId === this.coordinatorId ? [active.prompt, ...this.pending] : [...this.pending]
    this.pending.length = 0
    useHostKeyPromptDialog.getState().clear(this.coordinatorId)
    for (const prompt of prompts) this.rejectPrompt(prompt, 'host key prompt coordinator stopped')
  }

  private hasPending(attemptId: string) {
    return this.pending.some((item) => item.attemptId === attemptId)
  }

  private rejectPrompt(prompt: HostKeyPrompt, reason: string) {
    logger.warn(reason, { attemptId: prompt.attemptId, hostname: prompt.hostname })
    void rejectHostKeyAttempt(prompt.attemptId).catch((error: unknown) => {
      logger.error('reject host key prompt failed', error)
    })
  }

  private showPrompt(prompt: HostKeyPrompt, parsed?: HostKeyEndpoint) {
    const endpoint = parsed ?? parseHostKeyEndpoint(prompt.hostname)
    if (!endpoint) return this.rejectPrompt(prompt, 'invalid host key prompt endpoint')
    const shown = useHostKeyPromptDialog.getState().present({
      coordinatorId: this.coordinatorId,
      prompt,
      endpoint,
      decide: (accept) => SessionService.DecideHostKey(prompt.attemptId, accept),
      dismiss: () => rejectHostKeyAttempt(prompt.attemptId),
    })
    if (!shown) this.pending.unshift(prompt)
  }

  private schedulePump() {
    if (this.stopped || this.pumpScheduled) return
    this.pumpScheduled = true
    queueMicrotask(() => this.pump())
  }

  private pump() {
    this.pumpScheduled = false
    if (this.stopped || useHostKeyPromptDialog.getState().active) return
    const next = this.pending.shift()
    if (next) this.showPrompt(next)
  }
}

export function createHostKeyPromptCoordinator() {
  return new HostKeyPromptCoordinator()
}

async function rejectHostKeyAttempt(attemptId: string) {
  try {
    await SessionService.DecideHostKey(attemptId, false)
  } catch (decisionError) {
    try {
      await SessionService.CancelConnect(attemptId)
    } catch (cancelError) {
      throw new Error(`reject host key attempt failed: ${String(decisionError)}; cancel failed: ${String(cancelError)}`)
    }
  }
}

function isValidPrompt(prompt: HostKeyPrompt) {
  return Boolean(prompt.attemptId.trim() && prompt.hostname.trim() && prompt.fingerprint.trim())
}

function normalizeHost(host: string) {
  return host.trim().replace(/^\[|\]$/g, '').toLowerCase()
}

function parseHostKeyEndpoint(hostname: string): HostKeyEndpoint | null {
  const value = hostname.trim()
  const bracketed = /^\[([^\]]+)]:(\d+)$/.exec(value)
  if (bracketed) return endpoint(bracketed[1], bracketed[2])
  if ((value.match(/:/g) ?? []).length > 1) return { host: normalizeHost(value), port: 22 }
  const plain = /^(.*):(\d+)$/.exec(value)
  if (plain) return endpoint(plain[1], plain[2])
  return value ? { host: normalizeHost(value), port: 22 } : null
}

function endpoint(host: string, rawPort: string): HostKeyEndpoint | null {
  const port = Number(rawPort)
  if (!host.trim() || !Number.isInteger(port) || port < 1 || port > 65535) return null
  return { host: normalizeHost(host), port }
}

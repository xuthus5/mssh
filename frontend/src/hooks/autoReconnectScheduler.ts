export interface AutoReconnectTask {
  terminalID: string
  tabID: string
  canRun: () => boolean
  run: () => Promise<void>
  cancel: () => void
}

export type AutoReconnectEnqueueResult = 'enqueued' | 'duplicate' | 'full'

interface AutoReconnectSchedulerOptions {
  maxPending: number
  isBlocked: () => boolean
  onError?: (error: unknown) => void
}

export class AutoReconnectScheduler {
  private readonly pending = new Map<string, AutoReconnectTask>()
  private active: AutoReconnectTask | null = null
  private draining = false
  private scheduled = false

  constructor(private readonly options: AutoReconnectSchedulerOptions) {}

  enqueue(task: AutoReconnectTask): AutoReconnectEnqueueResult {
    if (this.active?.terminalID === task.terminalID || this.pending.has(task.terminalID)) return 'duplicate'
    if (this.pending.size >= Math.max(1, this.options.maxPending)) return 'full'
    this.pending.set(task.terminalID, task)
    this.wake()
    return 'enqueued'
  }

  cancelTerminal(terminalID: string): void {
    const pending = this.pending.get(terminalID)
    if (pending) {
      this.pending.delete(terminalID)
      this.cancelTask(pending)
    }
    if (this.active?.terminalID === terminalID) this.cancelTask(this.active)
  }

  cancelTab(tabID: string): void {
    for (const [terminalID, task] of this.pending) {
      if (task.tabID !== tabID) continue
      this.pending.delete(terminalID)
      this.cancelTask(task)
    }
    if (this.active?.tabID === tabID) this.cancelTask(this.active)
  }

  clear(): void {
    for (const task of this.pending.values()) this.cancelTask(task)
    this.pending.clear()
    if (this.active) this.cancelTask(this.active)
  }

  prune(): void {
    for (const [terminalID, task] of this.pending) {
      if (this.canRun(task)) continue
      this.pending.delete(terminalID)
      this.cancelTask(task)
    }
  }

  wake(): void {
    if (this.scheduled) return
    this.scheduled = true
    queueMicrotask(() => {
      this.scheduled = false
      void this.drain()
    })
  }

  private async drain(): Promise<void> {
    if (this.draining || this.active || this.options.isBlocked()) return
    this.draining = true
    try {
      while (!this.active && !this.options.isBlocked()) {
        const task = this.takeNext()
        if (!task) return
        if (!this.canRun(task)) continue
        this.active = task
        try {
          await task.run()
        } catch (error: unknown) {
          this.options.onError?.(error)
        } finally {
          if (this.active === task) this.active = null
        }
      }
    } finally {
      this.draining = false
      if (this.pending.size > 0 && !this.active && !this.options.isBlocked()) this.wake()
    }
  }

  private takeNext(): AutoReconnectTask | null {
    const next = this.pending.entries().next()
    if (next.done) return null
    const [terminalID, task] = next.value
    this.pending.delete(terminalID)
    return task
  }

  private canRun(task: AutoReconnectTask): boolean {
    try {
      return task.canRun()
    } catch (error: unknown) {
      this.options.onError?.(error)
      return false
    }
  }

  private cancelTask(task: AutoReconnectTask): void {
    try {
      task.cancel()
    } catch (error: unknown) {
      this.options.onError?.(error)
    }
  }
}

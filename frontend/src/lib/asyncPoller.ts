export interface AsyncPollerOptions {
  task: () => Promise<void>
  delayMs: number
  onError: (error: unknown) => void
}

export class AsyncPoller {
  private timer: ReturnType<typeof setTimeout> | null = null
  private activeTask: Promise<void> | null = null
  private queued = false
  private stopped = true

  constructor(private readonly options: AsyncPollerOptions) {}

  start(): Promise<void> {
    this.stopped = false
    return this.trigger()
  }

  trigger(): Promise<void> {
    if (this.stopped) return Promise.resolve()
    this.clearTimer()
    this.queued = true
    if (!this.activeTask) this.activeTask = this.drain()
    return this.activeTask
  }

  stop(): void {
    this.stopped = true
    this.queued = false
    this.clearTimer()
  }

  private async drain(): Promise<void> {
    try {
      while (!this.stopped && this.queued) {
        this.queued = false
        try {
          await this.options.task()
        } catch (error) {
          this.options.onError(error)
        }
      }
    } finally {
      this.activeTask = null
      if (!this.stopped) this.schedule()
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.timer = null
      void this.trigger()
    }, this.options.delayMs)
  }

  private clearTimer(): void {
    if (this.timer === null) return
    clearTimeout(this.timer)
    this.timer = null
  }
}

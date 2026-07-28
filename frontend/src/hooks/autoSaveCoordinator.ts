export interface AutoSaveRequest<T> {
  value: T
  serialized: string
  save: (value: T) => Promise<void>
}

interface AutoSaveEvents {
  onSaving: () => void
  onSaved: () => void
  onError: (error: unknown) => void
}

interface PendingSave<T> {
  request: AutoSaveRequest<T>
  savedSerialized: string
  force: boolean
  baselineGeneration: number
}

type SaveOutcome = { ok: true } | { ok: false; error: unknown }

export class AutoSaveCoordinator<T> {
  private lastSaved: string | null = null
  private activeTask: Promise<void> | null = null
  private activeSave: PendingSave<T> | null = null
  private pending: PendingSave<T> | null = null
  private baselineGeneration = 0

  constructor(private readonly events: AutoSaveEvents) {}

  initialize(serialized: string) {
    if (this.lastSaved !== null) return false
    this.lastSaved = serialized
    return true
  }

  isActive() {
    return this.activeTask !== null
  }

  isSaved(serialized: string) {
    return this.lastSaved === serialized
  }

  clearPending() {
    this.pending = null
  }

  synchronize(serialized: string) {
    this.baselineGeneration += 1
    this.lastSaved = serialized
    this.pending = null
  }

  redactLatest(sourceSerialized: string, redactedSerialized: string) {
    const pending = this.matchingSave(this.pending, sourceSerialized)
    if (pending) {
      pending.savedSerialized = redactedSerialized
      return true
    }
    const active = this.matchingSave(this.activeSave, sourceSerialized)
    if (active) {
      active.savedSerialized = redactedSerialized
      return true
    }
    if (this.lastSaved !== sourceSerialized) return false
    this.lastSaved = redactedSerialized
    return true
  }

  request(request: AutoSaveRequest<T>, force = false): Promise<void> {
    if (this.activeTask) return this.queueLatest(request)
    if (!force && this.isSaved(request.serialized)) {
      this.events.onSaved()
      return Promise.resolve()
    }
    this.events.onSaving()
    let resolveTask!: () => void
    let rejectTask!: (error: unknown) => void
    const task = new Promise<void>((resolve, reject) => {
      resolveTask = resolve
      rejectTask = reject
    })
    this.activeTask = task
    void this.drain({ request, savedSerialized: request.serialized, force, baselineGeneration: this.baselineGeneration }).then(resolveTask, rejectTask)
    return task
  }

  private queueLatest(request: AutoSaveRequest<T>) {
    this.events.onSaving()
    if (this.matchesSerialized(this.activeSave, request.serialized)) {
      this.pending = null
      return this.activeTask as Promise<void>
    }
    if (this.matchesSerialized(this.pending, request.serialized)) return this.activeTask as Promise<void>
    this.pending = {
      request,
      savedSerialized: request.serialized,
      force: true,
      baselineGeneration: this.baselineGeneration,
    }
    return this.activeTask as Promise<void>
  }

  private async drain(initial: PendingSave<T>) {
    try {
      let current: PendingSave<T> | null = initial
      while (current) {
        this.activeSave = current
        const outcome = await this.execute(current)
        if (outcome.ok && current.baselineGeneration === this.baselineGeneration) {
          this.lastSaved = current.savedSerialized
        }
        const next = this.pending
        this.pending = null
        if (next) {
          current = next
          continue
        }
        this.finish(outcome)
        current = null
      }
    } finally {
      this.activeSave = null
      this.activeTask = null
      this.pending = null
    }
  }

  private matchingSave(save: PendingSave<T> | null, serialized: string) {
    return this.matchesSerialized(save, serialized) ? save : null
  }

  private matchesSerialized(save: PendingSave<T> | null, serialized: string) {
    return save?.request.serialized === serialized || save?.savedSerialized === serialized
  }

  private async execute(pending: PendingSave<T>): Promise<SaveOutcome> {
    if (!pending.force && this.isSaved(pending.request.serialized)) return { ok: true }
    try {
      await pending.request.save(pending.request.value)
      return { ok: true }
    } catch (error) {
      return { ok: false, error }
    }
  }

  private finish(outcome: SaveOutcome) {
    if (outcome.ok) this.events.onSaved()
    else this.events.onError(outcome.error)
  }
}

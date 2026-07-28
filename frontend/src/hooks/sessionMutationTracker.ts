export class SessionMutationTracker {
  private sequence = 0
  private readonly generations = new Map<string, number>()

  begin(sessionID: string) {
    const generation = ++this.sequence
    this.generations.set(sessionID, generation)
    return generation
  }

  invalidate(sessionIDs: readonly string[]) {
    for (const sessionID of new Set(sessionIDs)) this.generations.delete(sessionID)
  }

  isCurrent(sessionID: string, generation: number) {
    return this.generations.get(sessionID) === generation
  }

  finish(sessionID: string, generation: number) {
    if (this.isCurrent(sessionID, generation)) this.generations.delete(sessionID)
  }

  get size() {
    return this.generations.size
  }
}

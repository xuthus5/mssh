export const DRAFT_REVISION_HISTORY_LIMIT = 32

export function draftRevisionFingerprint(serialized: string): string {
  let first = 0x811c9dc5
  let second = 0x9e3779b9
  for (let index = 0; index < serialized.length; index++) {
    const code = serialized.charCodeAt(index)
    first = Math.imul(first ^ code, 0x01000193)
    second = Math.imul(second ^ (code + index), 0x27d4eb2d)
  }
  return `${serialized.length.toString(36)}:${hex(first)}:${hex(second)}`
}

function hex(value: number): string {
  return (value >>> 0).toString(16).padStart(8, '0')
}

export class DraftRevisionHistory {
  private readonly revisions = new Map<string, number>()

  constructor(private readonly limit = DRAFT_REVISION_HISTORY_LIMIT) {
    if (!Number.isInteger(limit) || limit <= 0) throw new Error('history limit must be positive')
  }

  get size(): number {
    return this.revisions.size
  }

  record(serialized: string, revision: number): void {
    const fingerprint = draftRevisionFingerprint(serialized)
    const current = this.revisions.get(fingerprint) ?? -1
    this.revisions.delete(fingerprint)
    this.revisions.set(fingerprint, Math.max(current, revision))
    this.trim()
  }

  get(serialized: string): number | undefined {
    const fingerprint = draftRevisionFingerprint(serialized)
    const revision = this.revisions.get(fingerprint)
    if (revision === undefined) return undefined
    this.revisions.delete(fingerprint)
    this.revisions.set(fingerprint, revision)
    return revision
  }

  private trim(): void {
    while (this.revisions.size > this.limit) {
      const oldest = this.revisions.keys().next().value
      if (oldest === undefined) return
      this.revisions.delete(oldest)
    }
  }
}

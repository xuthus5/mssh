import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react'

interface UseDraftSyncOptions<TSource, TDraft extends object> {
  source: TSource
  createDraft: (source: TSource) => TDraft
  serialize?: (draft: TDraft) => string
}

interface UseDraftSyncResult<TDraft extends object> {
  draft: TDraft
  setDraft: Dispatch<SetStateAction<TDraft>>
  acknowledgeSaved: (draft: TDraft) => void
}

interface DraftSyncState<TDraft extends object> {
  draft: TDraft
  revision: number
  cleanRevision: number
  sourceKey: string
  revisions: WeakMap<TDraft, number>
  savedRevisions: Map<string, number>
}

const defaultSerialize = <TDraft extends object>(draft: TDraft) => JSON.stringify(draft)

function resolveDraft<TDraft>(action: SetStateAction<TDraft>, current: TDraft): TDraft {
  return typeof action === 'function' ? (action as (value: TDraft) => TDraft)(current) : action
}

function createSyncState<TDraft extends object>(draft: TDraft, sourceKey: string): DraftSyncState<TDraft> {
  const revisions = new WeakMap<TDraft, number>()
  revisions.set(draft, 0)
  return { draft, revision: 0, cleanRevision: 0, sourceKey, revisions, savedRevisions: new Map([[sourceKey, 0]]) }
}

export function useDraftSync<TSource, TDraft extends object>({
  source,
  createDraft,
  serialize = defaultSerialize,
}: UseDraftSyncOptions<TSource, TDraft>): UseDraftSyncResult<TDraft> {
  const sourceDraft = useMemo(() => createDraft(source), [createDraft, source])
  const sourceKey = useMemo(() => serialize(sourceDraft), [serialize, sourceDraft])
  const stateRef = useRef<DraftSyncState<TDraft> | null>(null)
  if (stateRef.current === null) stateRef.current = createSyncState(sourceDraft, sourceKey)
  const [draft, setDraftState] = useState(sourceDraft)

  const setDraft = useCallback<Dispatch<SetStateAction<TDraft>>>((action) => {
    const state = stateRef.current!
    const next = resolveDraft(action, state.draft)
    if (serialize(next) !== serialize(state.draft)) state.revision += 1
    state.draft = next
    state.revisions.set(next, state.revision)
    setDraftState(next)
  }, [serialize])

  const acknowledgeSaved = useCallback((saved: TDraft) => {
    const state = stateRef.current!
    const revision = state.revisions.get(saved) ?? state.revision
    const savedKey = serialize(saved)
    state.savedRevisions.set(savedKey, Math.max(state.savedRevisions.get(savedKey) ?? -1, revision))
    if (serialize(state.draft) === savedKey && state.revision === revision) state.cleanRevision = revision
  }, [serialize])

  useEffect(() => {
    const state = stateRef.current!
    if (state.sourceKey === sourceKey) return
    state.sourceKey = sourceKey
    const currentKey = serialize(state.draft)
    if (currentKey === sourceKey) {
      state.cleanRevision = state.revision
      state.savedRevisions.set(sourceKey, state.revision)
      return
    }
    const sourceRevision = state.savedRevisions.get(sourceKey)
    if (state.revision > state.cleanRevision || (sourceRevision !== undefined && sourceRevision < state.revision)) return
    state.revision += 1
    state.cleanRevision = state.revision
    state.draft = sourceDraft
    state.revisions.set(sourceDraft, state.revision)
    state.savedRevisions.set(sourceKey, state.revision)
    setDraftState(sourceDraft)
  }, [serialize, sourceDraft, sourceKey])

  return { draft, setDraft, acknowledgeSaved }
}

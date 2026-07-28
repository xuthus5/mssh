import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react'
import { DraftRevisionHistory } from '@/hooks/draftRevisionHistory'

interface UseDraftSyncOptions<TSource, TDraft extends object> {
  source: TSource
  createDraft: (source: TSource) => TDraft
  serialize?: (draft: TDraft) => string
}

interface UseDraftSyncResult<TDraft extends object> {
  draft: TDraft
  setDraft: Dispatch<SetStateAction<TDraft>>
  acknowledgeSaved: (draft: TDraft, authoritative?: TDraft) => void
  baselineRevision: number
}

interface DraftSyncState<TDraft extends object> {
  draft: TDraft
  revision: number
  cleanRevision: number
  sourceKey: string
  revisions: WeakMap<TDraft, number>
  savedRevisions: DraftRevisionHistory
  pendingSource: PendingSource<TDraft> | null
}

interface PendingSource<TDraft extends object> {
  draft: TDraft
  key: string
  observedRevision: number
}

const defaultSerialize = <TDraft extends object>(draft: TDraft) => JSON.stringify(draft)

function resolveDraft<TDraft>(action: SetStateAction<TDraft>, current: TDraft): TDraft {
  return typeof action === 'function' ? (action as (value: TDraft) => TDraft)(current) : action
}

function createSyncState<TDraft extends object>(draft: TDraft, sourceKey: string): DraftSyncState<TDraft> {
  const revisions = new WeakMap<TDraft, number>()
  const savedRevisions = new DraftRevisionHistory()
  revisions.set(draft, 0)
  savedRevisions.record(sourceKey, 0)
  return { draft, revision: 0, cleanRevision: 0, sourceKey, revisions, savedRevisions, pendingSource: null }
}

function applySource<TDraft extends object>({ state, source, publish }: {
  state: DraftSyncState<TDraft>
  source: PendingSource<TDraft>
  publish: (draft: TDraft) => void
}) {
  state.revision += 1
  state.cleanRevision = state.revision
  state.draft = source.draft
  state.revisions.set(source.draft, state.revision)
  state.savedRevisions.record(source.key, state.revision)
  state.pendingSource = null
  publish(source.draft)
}

function useDraftPublisher<TDraft extends object>(sourceDraft: TDraft) {
  const [draft, setDraftState] = useState(sourceDraft)
  const [baselineRevision, setBaselineRevision] = useState(0)
  const publishSource = useCallback((next: TDraft) => {
    setDraftState(next)
    setBaselineRevision((current) => current + 1)
  }, [])
  return { draft, setDraftState, baselineRevision, setBaselineRevision, publishSource }
}

function useDraftUpdater<TDraft extends object>(
  stateRef: RefObject<DraftSyncState<TDraft> | null>,
  serialize: (draft: TDraft) => string,
  setDraftState: Dispatch<SetStateAction<TDraft>>,
) {
  return useCallback<Dispatch<SetStateAction<TDraft>>>((action) => {
    const state = stateRef.current!
    const next = resolveDraft(action, state.draft)
    if (serialize(next) !== serialize(state.draft)) {
      state.revision += 1
      state.pendingSource = null
    }
    state.draft = next
    state.revisions.set(next, state.revision)
    setDraftState(next)
  }, [serialize, setDraftState, stateRef])
}

function useSavedDraftAcknowledgement<TDraft extends object>(
  stateRef: RefObject<DraftSyncState<TDraft> | null>,
  serialize: (draft: TDraft) => string,
  publishSource: (draft: TDraft) => void,
) {
  return useCallback((saved: TDraft, authoritative?: TDraft) => {
    const state = stateRef.current!
    const revision = state.revisions.get(saved) ?? state.revision
    const savedKey = serialize(saved)
    state.savedRevisions.record(savedKey, revision)
    if (serialize(state.draft) !== savedKey || state.revision !== revision) return
    state.cleanRevision = revision
    const pending = state.pendingSource
    if (pending?.observedRevision === revision) {
      applySource({ state, source: pending, publish: publishSource })
      return
    }
    if (!authoritative || serialize(authoritative) === savedKey) return
    applySource({
      state,
      source: { draft: authoritative, key: serialize(authoritative), observedRevision: revision },
      publish: publishSource,
    })
  }, [publishSource, serialize, stateRef])
}

interface SourceSynchronizationOptions<TDraft extends object> {
  stateRef: RefObject<DraftSyncState<TDraft> | null>
  sourceDraft: TDraft
  sourceKey: string
  serialize: (draft: TDraft) => string
  publishSource: (draft: TDraft) => void
  advanceBaseline: () => void
}

function useSourceSynchronization<TDraft extends object>({
  stateRef,
  sourceDraft,
  sourceKey,
  serialize,
  publishSource,
  advanceBaseline,
}: SourceSynchronizationOptions<TDraft>) {
  useEffect(() => {
    const state = stateRef.current!
    if (state.sourceKey === sourceKey) return
    state.sourceKey = sourceKey
    const currentKey = serialize(state.draft)
    if (currentKey === sourceKey) {
      state.cleanRevision = state.revision
      state.savedRevisions.record(sourceKey, state.revision)
      state.pendingSource = null
      advanceBaseline()
      return
    }
    const sourceRevision = state.savedRevisions.get(sourceKey)
    if (sourceRevision !== undefined && sourceRevision < state.revision) {
      state.pendingSource = null
      return
    }
    const pending = { draft: sourceDraft, key: sourceKey, observedRevision: state.revision }
    if (state.revision > state.cleanRevision) {
      state.pendingSource = pending
      return
    }
    applySource({ state, source: pending, publish: publishSource })
  }, [advanceBaseline, publishSource, serialize, sourceDraft, sourceKey, stateRef])
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
  const publisher = useDraftPublisher(sourceDraft)
  const setDraft = useDraftUpdater(stateRef, serialize, publisher.setDraftState)
  const acknowledgeSaved = useSavedDraftAcknowledgement(stateRef, serialize, publisher.publishSource)
  const advanceBaseline = useCallback(() => publisher.setBaselineRevision((current) => current + 1), [publisher.setBaselineRevision])
  useSourceSynchronization({ stateRef, sourceDraft, sourceKey, serialize, publishSource: publisher.publishSource, advanceBaseline })
  return { draft: publisher.draft, setDraft, acknowledgeSaved, baselineRevision: publisher.baselineRevision }
}

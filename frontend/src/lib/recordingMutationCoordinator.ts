import { create } from 'zustand'
import { t } from '@/i18n'
import { OperationBusyError } from '@/lib/operationBusyError'

interface RecordingMutationState {
  busyRecordingIDs: ReadonlySet<number>
}

interface RecordingCatalogChange {
  sessionID: number
  source: symbol
}

const recordingCatalogChangedEvent = 'mssh:recording-catalog-changed'
const activeRecordingIDs = new Set<number>()

export const useRecordingMutationState = create<RecordingMutationState>(() => ({ busyRecordingIDs: new Set() }))

function publishMutationState() {
  useRecordingMutationState.setState({ busyRecordingIDs: new Set(activeRecordingIDs) })
}

export function isRecordingMutationActive(recordingID: number) {
  return activeRecordingIDs.has(recordingID)
}

export async function runRecordingMutation<T>(recordingID: number, operation: () => Promise<T>): Promise<T> {
  if (activeRecordingIDs.has(recordingID)) throw new OperationBusyError(t('录制删除操作正在进行'))
  activeRecordingIDs.add(recordingID)
  publishMutationState()
  try {
    return await operation()
  } finally {
    activeRecordingIDs.delete(recordingID)
    publishMutationState()
  }
}

export function emitRecordingCatalogChanged(sessionID: number, source: symbol) {
  const detail: RecordingCatalogChange = { sessionID, source }
  window.dispatchEvent(new CustomEvent<RecordingCatalogChange>(recordingCatalogChangedEvent, { detail }))
}

export function onRecordingCatalogChanged(sessionID: number, source: symbol, handler: () => void) {
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<RecordingCatalogChange>).detail
    if (detail?.sessionID === sessionID && detail.source !== source) handler()
  }
  window.addEventListener(recordingCatalogChangedEvent, listener)
  return () => window.removeEventListener(recordingCatalogChangedEvent, listener)
}

export function resetRecordingMutationCoordinator() {
  activeRecordingIDs.clear()
  publishMutationState()
}

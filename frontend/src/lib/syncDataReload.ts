import { Events } from '@wailsio/runtime'

export const syncDataChangedEvent = 'sync:data-changed'

export function registerSyncDataReload(reload: () => void): () => void {
  return Events.On(syncDataChangedEvent, reload)
}

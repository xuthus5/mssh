import { useCallback, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { SessionService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import { mapFolder, type Folder, type Session } from '@/lib/sessionModels'
import { remapAfterFolderDelete } from '@/lib/sessionFolderDelete'

interface FolderActionOptions {
  captureLifecycle: () => () => boolean
  invalidateFolderRequests: () => void
  invalidateSessionMutations: (ids: string[]) => void
  foldersRef: MutableRefObject<Folder[]>
  sessionsRef: MutableRefObject<Session[]>
  recentSessionsRef: MutableRefObject<Session[]>
  setFolders: Dispatch<SetStateAction<Folder[]>>
  setSessions: Dispatch<SetStateAction<Session[]>>
  setRecentSessions: Dispatch<SetStateAction<Session[]>>
}

function useCreateFolder({ captureLifecycle, invalidateFolderRequests, setFolders }: FolderActionOptions) {
  return useCallback(async (name: string, parentId: string | null) => {
    const isActive = captureLifecycle()
    try {
      const result = await SessionService.CreateFolder(name, parentId ? Number(parentId) : null)
      if (result && isActive()) {
        invalidateFolderRequests()
        setFolders((previous) => [...previous, mapFolder(result)])
      }
      return result ? mapFolder(result) : undefined
    } catch (error) {
      logger.error('createFolder error', error)
      throw error
    }
  }, [captureLifecycle, invalidateFolderRequests, setFolders])
}

function useDeleteFolder(options: FolderActionOptions) {
  return useCallback(async (id: string) => {
    const isActive = options.captureLifecycle()
    try {
      await SessionService.DeleteFolder(Number(id))
      if (!isActive()) return
      const affectedIDs = options.sessionsRef.current.filter((session) => session.folderId === id).map((session) => session.id)
      options.invalidateFolderRequests()
      options.invalidateSessionMutations(affectedIDs)
      const remapped = remapAfterFolderDelete(options.foldersRef.current, options.sessionsRef.current, id)
      const recentRemapped = remapAfterFolderDelete(options.foldersRef.current, options.recentSessionsRef.current, id)
      options.setFolders(remapped.folders)
      options.setSessions(remapped.sessions)
      options.setRecentSessions(recentRemapped.sessions)
    } catch (error) {
      logger.error('deleteFolder error', error)
      throw error
    }
  }, [options])
}

function useUpdateFolder({ captureLifecycle, invalidateFolderRequests, setFolders }: FolderActionOptions) {
  return useCallback(async (id: string, name: string) => {
    const isActive = captureLifecycle()
    try {
      await SessionService.UpdateFolder(Number(id), name)
      if (isActive()) {
        invalidateFolderRequests()
        setFolders((previous) => previous.map((folder) => (folder.id === id ? { ...folder, name } : folder)))
      }
    } catch (error) {
      logger.error('updateFolder error', error)
      throw error
    }
  }, [captureLifecycle, invalidateFolderRequests, setFolders])
}

function useSetDefaultFolder({ captureLifecycle, invalidateFolderRequests, setFolders }: FolderActionOptions) {
  return useCallback(async (id: string) => {
    const isActive = captureLifecycle()
    try {
      await SessionService.SetDefaultFolder(Number(id))
      if (isActive()) {
        invalidateFolderRequests()
        setFolders((previous) => previous.map((folder) => ({ ...folder, isDefault: folder.id === id })))
      }
    } catch (error) {
      logger.error('setDefaultFolder error', error)
      throw error
    }
  }, [captureLifecycle, invalidateFolderRequests, setFolders])
}

export function useSessionFolderActions(options: FolderActionOptions) {
  return {
    createFolder: useCreateFolder(options),
    deleteFolder: useDeleteFolder(options),
    updateFolder: useUpdateFolder(options),
    setDefaultFolder: useSetDefaultFolder(options),
  }
}

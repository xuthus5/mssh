export interface FolderLike {
  id: string
  parentId: string | null
  isDefault?: boolean
}

export interface SessionLike {
  folderId: string | null
}

/** Remap folders/sessions after a folder delete using one pre-delete snapshot. */
export function remapAfterFolderDelete<F extends FolderLike, S extends SessionLike>(
  folders: F[],
  sessions: S[],
  deletedID: string,
): { folders: F[]; sessions: S[] } {
  let defaultID = folders.find((folder) => folder.isDefault)?.id ?? null
  if (defaultID === deletedID) {
    defaultID = folders.find((folder) => folder.id !== deletedID)?.id ?? null
  }
  return {
    folders: folders
      .filter((folder) => folder.id !== deletedID)
      .map((folder) => (folder.parentId === deletedID ? { ...folder, parentId: defaultID } : folder)),
    sessions: sessions.map((session) => (
      session.folderId === deletedID ? { ...session, folderId: defaultID } : session
    )),
  }
}

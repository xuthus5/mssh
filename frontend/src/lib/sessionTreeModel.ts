import type { Folder, Session } from '@/hooks/useSession'

export type SessionTreeNode =
  | { kind: 'folder'; id: string; folder: Folder; depth: number; expanded: boolean }
  | { kind: 'session'; id: string; session: Session; depth: number }

export function buildVisibleSessionTreeNodes(
  folders: Folder[],
  sessions: Session[],
  expanded: Set<string>,
  revealAll = false,
): SessionTreeNode[] {
  const nodes: SessionTreeNode[] = []
  const rootFolders = folders.filter((folder) => folder.parentId === null)
  const walkFolder = (folder: Folder, depth: number) => {
    const isExpanded = revealAll || expanded.has(folder.id)
    nodes.push({ kind: 'folder', id: `folder-${folder.id}`, folder, depth, expanded: isExpanded })
    if (!isExpanded) return
    for (const child of folders.filter((item) => item.parentId === folder.id)) walkFolder(child, depth + 1)
    for (const session of sessions.filter((item) => item.folderId === folder.id)) {
      nodes.push({ kind: 'session', id: `session-${session.id}`, session, depth: depth + 1 })
    }
  }
  for (const folder of rootFolders) walkFolder(folder, 0)
  for (const session of sessions.filter((item) => item.folderId === null)) {
    nodes.push({ kind: 'session', id: `session-${session.id}`, session, depth: 0 })
  }
  return nodes
}

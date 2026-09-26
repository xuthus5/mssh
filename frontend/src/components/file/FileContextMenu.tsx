import type { ReactNode } from 'react'
import { Download, FilePlus, FolderPlus, PenLine, RefreshCw, Trash2, Upload } from 'lucide-react'
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { t } from '@/i18n'

export interface FileContextMenuActions {
  onUpload: () => void
  onDownload: (path: string) => void
  onRename: () => void
  onCreateFile: () => void
  onMakeDir: () => void
  onDelete: () => void
  onRefresh: () => void
}

interface Props {
  selected: FileInfo | null
  transferPending: boolean
  directoryMutationBusy: boolean
  selectedMutationBusy: boolean
  actions: FileContextMenuActions
  children: ReactNode
}

/** Right-click menu for the file panel: file actions act on the selected entry, the rest on the open directory. */
export function FileContextMenu({ selected, transferPending, directoryMutationBusy, selectedMutationBusy, actions, children }: Props) {
  const fileTarget = selected !== null
  const canMutateSelection = fileTarget && !selectedMutationBusy
  return <ContextMenu>
    <ContextMenuTrigger className="flex min-h-0 flex-1 flex-col">{children}</ContextMenuTrigger>
    <ContextMenuContent>
      <ContextMenuItem disabled={transferPending || directoryMutationBusy} onClick={actions.onUpload}>
        <Upload />{t('上传')}
      </ContextMenuItem>
      <ContextMenuItem disabled={!selected || selected.isDir || transferPending || selectedMutationBusy}
        onClick={() => { if (selected && !selected.isDir) actions.onDownload(selected.path) }}>
        <Download />{t('下载')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={!canMutateSelection} onClick={actions.onRename}>
        <PenLine />{t('重命名')}
      </ContextMenuItem>
      <ContextMenuItem variant="destructive" disabled={!canMutateSelection} onClick={actions.onDelete}>
        <Trash2 />{t('删除')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem disabled={directoryMutationBusy} onClick={actions.onCreateFile}>
        <FilePlus />{t('新建文件')}
      </ContextMenuItem>
      <ContextMenuItem disabled={directoryMutationBusy} onClick={actions.onMakeDir}>
        <FolderPlus />{t('新建文件夹')}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem onClick={actions.onRefresh}>
        <RefreshCw />{t('刷新')}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
}

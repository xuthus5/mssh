import { useState, type UIEvent } from 'react'
import { File, FolderOpen } from 'lucide-react'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { computeVirtualWindow } from '@/lib/virtualWindow'
import { t } from '@/i18n'


interface Props {
  files: FileInfo[]
  loading: boolean
  selected: FileInfo | null
  onSelect: (file: FileInfo) => void
  onNavigate: (path: string) => void
  onDownload: (path: string) => void
}

const ROW_HEIGHT = 36

export function FileListView(props: Props) {
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(360)
  if (props.loading) return <EmptyRow text={t('加载中...')} />
  if (props.files.length === 0) return <EmptyRow text={t('空目录')} />
  const windowed = computeVirtualWindow({
    count: props.files.length,
    estimateSize: ROW_HEIGHT,
    scrollOffset: scrollTop,
    viewportSize: viewportHeight || Math.min(props.files.length, 30) * ROW_HEIGHT,
    overscan: props.files.length <= 40 ? props.files.length : 6,
  })
  return (
    <div className="h-full overflow-auto" onScroll={(event: UIEvent<HTMLDivElement>) => {
      setScrollTop(event.currentTarget.scrollTop)
      setViewportHeight(event.currentTarget.clientHeight)
    }}>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-8" />
            <TableHead>{t('名称')}</TableHead>
            <TableHead className="text-right">{t('大小')}</TableHead>
            <TableHead className="text-right">{t('修改时间')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {windowed.startIndex > 0 ? (
            <TableRow aria-hidden="true"><TableCell colSpan={4} style={{ height: windowed.startIndex * ROW_HEIGHT, padding: 0 }} /></TableRow>
          ) : null}
          {windowed.items.map((item) => {
            const file = props.files[item.index]
            return (
              <TableRow key={file.path} data-state={props.selected?.path === file.path ? 'selected' : undefined} onClick={() => props.onSelect(file)}>
                <TableCell>{file.isDir ? <FolderOpen className="size-4" /> : <File className="size-4" />}</TableCell>
                <TableCell>
                  <button type="button" className="cursor-pointer text-left hover:underline" onClick={() => { if (file.isDir) props.onNavigate(file.path) }} onDoubleClick={() => { if (!file.isDir) props.onDownload(file.path) }}>
                    {file.name}
                  </button>
                </TableCell>
                <TableCell className="text-right">{file.isDir ? '-' : formatFileSize(file.size)}</TableCell>
                <TableCell className="text-right text-xs">{file.modified}</TableCell>
              </TableRow>
            )
          })}
          {windowed.endIndex < props.files.length - 1 ? (
            <TableRow aria-hidden="true"><TableCell colSpan={4} style={{ height: (props.files.length - windowed.endIndex - 1) * ROW_HEIGHT, padding: 0 }} /></TableRow>
          ) : null}
        </TableBody>
      </Table>
    </div>
  )
}

function EmptyRow({ text }: { text: string }) {
  return <Table><TableBody><TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{text}</TableCell></TableRow></TableBody></Table>
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  if (index >= units.length) return `${bytes} B`
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

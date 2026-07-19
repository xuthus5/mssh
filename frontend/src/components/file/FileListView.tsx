import { File, FolderOpen } from 'lucide-react'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'

interface Props {
  files: FileInfo[]
  loading: boolean
  selected: FileInfo | null
  onSelect: (file: FileInfo) => void
  onNavigate: (path: string) => void
  onDownload: (path: string) => void
}

export function FileListView(props: Props) {
  return <Table><TableHeader><TableRow><TableHead className="w-8" /><TableHead>名称</TableHead><TableHead className="text-right">大小</TableHead><TableHead className="text-right">修改时间</TableHead></TableRow></TableHeader><TableBody>
    {props.loading ? <EmptyRow text="加载中..." /> : props.files.length === 0 ? <EmptyRow text="空目录" /> : props.files.map((file) => <TableRow key={file.path} data-state={props.selected?.path === file.path ? 'selected' : undefined} onClick={() => props.onSelect(file)}>
      <TableCell>{file.isDir ? <FolderOpen className="size-4" /> : <File className="size-4" />}</TableCell>
      <TableCell><button type="button" className="cursor-pointer text-left hover:underline" onClick={() => { if (file.isDir) props.onNavigate(file.path) }} onDoubleClick={() => { if (!file.isDir) props.onDownload(file.path) }}>{file.name}</button></TableCell>
      <TableCell className="text-right">{file.isDir ? '-' : formatFileSize(file.size)}</TableCell><TableCell className="text-right text-xs">{file.modified}</TableCell>
    </TableRow>)}
    </TableBody></Table>
}

function EmptyRow({ text }: { text: string }) {
  return <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{text}</TableCell></TableRow>
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.floor(Math.log(bytes) / Math.log(1024))
  if (index >= units.length) return `${bytes} B`
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

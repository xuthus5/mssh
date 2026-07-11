import { useState, useEffect, type FormEvent } from 'react'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Button } from '@/components/ui/button'
import type { FileInfo } from '@/hooks/useFileTransfer'
import { FolderOpen, File, ArrowUp } from 'lucide-react'

interface Props {
  open: boolean
  onClose: () => void
  files: FileInfo[]
  currentPath: string
  loading: boolean
  onNavigateTo: (path: string) => void
  onNavigateUp: () => void
  onDelete: (path: string) => void
  onRename: (oldPath: string, newName: string) => void
  onMakeDir: (name: string) => void
  onUpload: () => void
  onDownload: (path: string) => void
}

export default function FilePanel({
  open,
  onClose,
  files,
  currentPath,
  loading,
  onNavigateTo,
  onNavigateUp,
  onDelete,
  onRename,
  onMakeDir,
  onUpload,
  onDownload,
}: Props) {
  const [mkdirName, setMkdirName] = useState('')
  const [showMkdir, setShowMkdir] = useState(false)

  useEffect(() => {
    setMkdirName('')
  }, [currentPath])

  const handleMkdirSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (mkdirName.trim()) {
      onMakeDir(mkdirName.trim())
      setMkdirName('')
      setShowMkdir(false)
    }
  }

  if (!open) return null

  const breadcrumbs = currentPath
    .split('/')
    .filter(Boolean)
    .reduce<{ name: string; path: string }[]>(
      (acc, part, _idx) => {
        const path = acc.length > 0 ? `${acc[acc.length - 1].path}/${part}` : `/${part}`
        acc.push({ name: part, path })
        return acc
      },
      [],
    )

  return (
    <aside className="w-[340px] flex-shrink-0 flex flex-col border-l border-border bg-card">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border">
        <span className="text-sm font-medium">文件管理</span>
        <Button size="xs" variant="ghost" onClick={onClose}>
          关闭
        </Button>
      </div>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border overflow-x-auto">
        <button
          type="button"
          className="flex-shrink-0 p-0.5 hover:bg-muted rounded"
          onClick={onNavigateUp}
        >
          <ArrowUp className="h-3.5 w-3.5" />
        </button>
        {currentPath === '/' ? (
          <span className="text-sm text-muted-foreground">/</span>
        ) : (
          breadcrumbs.map((crumb) => (
            <span key={crumb.path} className="flex items-center gap-0 text-sm">
              <span className="text-muted-foreground">/</span>
              <button
                type="button"
                className="hover:underline text-muted-foreground hover:text-foreground"
                onClick={() => onNavigateTo(crumb.path)}
              >
                {crumb.name}
              </button>
            </span>
          ))
        )}
      </div>
      <div className="flex items-center gap-1 px-3 py-1.5 border-b border-border">
        <Button size="xs" variant="outline" onClick={onUpload}>
          上传
        </Button>
        <Button
          size="xs"
          variant="outline"
          onClick={() => setShowMkdir(!showMkdir)}
        >
          新建文件夹
        </Button>
      </div>
      {showMkdir && (
        <form
          onSubmit={handleMkdirSubmit}
          className="flex items-center gap-1 px-3 py-1.5 border-b border-border"
        >
          <input
            className="flex-1 h-7 px-2 text-sm rounded border border-input bg-transparent outline-none"
            placeholder="文件夹名"
            value={mkdirName}
            onChange={(e) => setMkdirName(e.target.value)}
            autoFocus
          />
          <Button size="xs" type="submit">
            确定
          </Button>
        </form>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-[24px]" />
              <TableHead>名称</TableHead>
              <TableHead className="text-right">大小</TableHead>
              <TableHead className="text-right">修改时间</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  加载中...
                </TableCell>
              </TableRow>
            ) : files.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-center text-muted-foreground">
                  空目录
                </TableCell>
              </TableRow>
            ) : (
              files.map((f) => (
                <TableRow key={f.path}>
                  <TableCell>
                    {f.isDir ? (
                      <FolderOpen className="h-4 w-4" />
                    ) : (
                      <File className="h-4 w-4" />
                    )}
                  </TableCell>
                  <TableCell>
                    <button
                      type="button"
                      className="hover:underline cursor-pointer text-left"
                      onClick={() => {
                        if (f.isDir) {
                          onNavigateTo(f.path)
                        }
                      }}
                      onDoubleClick={() => {
                        if (!f.isDir) {
                          onDownload(f.path)
                        }
                      }}
                    >
                      {f.name}
                    </button>
                  </TableCell>
                  <TableCell className="text-right">
                    {f.isDir ? '-' : formatSize(f.size)}
                  </TableCell>
                  <TableCell className="text-right text-xs">
                    {f.modified}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>
    </aside>
  )
}

function formatSize(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const i = Math.floor(Math.log(bytes) / Math.log(1024))
  if (i >= units.length) return `${bytes} B`
  return `${(bytes / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${units[i]}`
}

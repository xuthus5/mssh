import { useState, type FormEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Tunnel } from '@/hooks/useSession'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tunnels: Tunnel[]
  onStart: (tunnel: Omit<Tunnel, 'id' | 'running'>) => void
  onStop: (tunnelId: string) => void
  sessionId: string
}

export default function TunnelDialog({
  open,
  onOpenChange,
  tunnels,
  onStart,
  onStop,
  sessionId: _sessionId,
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [type, setType] = useState<string>('local')
  const [localAddress, setLocalAddress] = useState('')
  const [localPort, setLocalPort] = useState('')
  const [remoteAddress, setRemoteAddress] = useState('')
  const [remotePort, setRemotePort] = useState('')

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onStart({
      sessionId: _sessionId,
      type: type as Tunnel['type'],
      localAddress: localAddress || '127.0.0.1',
      localPort: parseInt(localPort, 10) || 0,
      remoteAddress: remoteAddress || '127.0.0.1',
      remotePort: parseInt(remotePort, 10) || 0,
    })
    setLocalAddress('')
    setLocalPort('')
    setRemoteAddress('')
    setRemotePort('')
    setShowAdd(false)
  }

  const typeLabel = (t: string) => {
    switch (t) {
      case 'local': return '本地转发'
      case 'remote': return '远程转发'
      case 'dynamic': return '动态转发'
      default: return t
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>隧道管理</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdd(!showAdd)}
            >
              {showAdd ? '取消' : '新建隧道'}
            </Button>
          </div>
          {showAdd && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3 rounded-lg border border-border">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  类型
                </label>
                <Select value={type} onValueChange={(value) => setType(value ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="local">本地转发</SelectItem>
                    <SelectItem value="remote">远程转发</SelectItem>
                    <SelectItem value="dynamic">动态转发</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {type !== 'dynamic' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        本地地址
                      </label>
                      <Input
                        value={localAddress}
                        onChange={(e) => setLocalAddress(e.target.value)}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        本地端口
                      </label>
                      <Input
                        type="number"
                        value={localPort}
                        onChange={(e) => setLocalPort(e.target.value)}
                        placeholder="8080"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        远程地址
                      </label>
                      <Input
                        value={remoteAddress}
                        onChange={(e) => setRemoteAddress(e.target.value)}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        远程端口
                      </label>
                      <Input
                        type="number"
                        value={remotePort}
                        onChange={(e) => setRemotePort(e.target.value)}
                        placeholder="80"
                      />
                    </div>
                  </div>
                </>
              )}
              {type === 'dynamic' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      本地地址
                    </label>
                    <Input
                      value={localAddress}
                      onChange={(e) => setLocalAddress(e.target.value)}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      本地端口
                    </label>
                    <Input
                      type="number"
                      value={localPort}
                      onChange={(e) => setLocalPort(e.target.value)}
                      placeholder="1080"
                    />
                  </div>
                </div>
              )}
              <DialogFooter showCloseButton>
                <Button type="submit">启动</Button>
              </DialogFooter>
            </form>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>类型</TableHead>
                <TableHead>本地</TableHead>
                <TableHead>远程</TableHead>
                <TableHead>状态</TableHead>
                <TableHead className="text-right">操作</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tunnels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    无隧道
                  </TableCell>
                </TableRow>
              ) : (
                tunnels.map((t) => (
                  <TableRow key={t.id}>
                    <TableCell>{typeLabel(t.type)}</TableCell>
                    <TableCell>
                      {t.localAddress}:{t.localPort}
                    </TableCell>
                    <TableCell>
                      {t.type !== 'dynamic'
                        ? `${t.remoteAddress}:${t.remotePort}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs ${t.running ? 'text-green-400' : 'text-muted-foreground'}`}
                      >
                        {t.running ? '运行中' : '已停止'}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {t.running ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => onStop(t.id)}
                        >
                          停止
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            onStart({
                              sessionId: t.sessionId,
                              type: t.type,
                              localAddress: t.localAddress,
                              localPort: t.localPort,
                              remoteAddress: t.remoteAddress,
                              remotePort: t.remotePort,
                            })
                          }
                        >
                          启动
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  )
}

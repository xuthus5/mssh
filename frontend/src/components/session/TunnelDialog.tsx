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
import { LabeledSelect } from '@/components/ui/labeled-select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { Tunnel } from '@/hooks/useSession'
import { t } from '@/i18n'


interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tunnels: Tunnel[]
  onStart: (tunnel: Omit<Tunnel, 'id' | 'running'>) => void
  onStop: (tunnelId: string) => void
  sessionId: string
}

const TUNNEL_TYPE_OPTIONS = [
  { value: 'local', label: t('本地转发') },
  { value: 'remote', label: t('远程转发') },
  { value: 'dynamic', label: t('动态转发') },
]

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

  const typeLabel = (type: string) => {
    switch (type) {
      case 'local': return t('本地转发')
      case 'remote': return t('远程转发')
      case 'dynamic': return t('动态转发')
      default: return type
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{t('隧道管理')}</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-3">
          <div className="flex items-center">
            <Button
              size="sm"
              variant="outline"
              onClick={() => setShowAdd(!showAdd)}
            >
              {showAdd ? t('取消') : t('新建隧道')}
            </Button>
          </div>
          {showAdd && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 p-3 rounded-lg border border-border">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  {t('类型')}
                </label>
                <LabeledSelect value={type} options={TUNNEL_TYPE_OPTIONS} onValueChange={setType} />
              </div>
              {type !== 'dynamic' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('本地地址')}
                      </label>
                      <Input
                        value={localAddress}
                        onChange={(e) => setLocalAddress(e.target.value)}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('本地端口')}
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
                        {t('远程地址')}
                      </label>
                      <Input
                        value={remoteAddress}
                        onChange={(e) => setRemoteAddress(e.target.value)}
                        placeholder="127.0.0.1"
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">
                        {t('远程端口')}
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
                      {t('本地地址')}
                    </label>
                    <Input
                      value={localAddress}
                      onChange={(e) => setLocalAddress(e.target.value)}
                      placeholder="127.0.0.1"
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">
                      {t('本地端口')}
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
                <Button type="submit">{t('启动')}</Button>
              </DialogFooter>
            </form>
          )}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('类型')}</TableHead>
                <TableHead>{t('本地')}</TableHead>
                <TableHead>{t('远程')}</TableHead>
                <TableHead>{t('状态')}</TableHead>
                <TableHead className="text-right">{t('操作')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {tunnels.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground">
                    {t('无隧道')}
                  </TableCell>
                </TableRow>
              ) : (
                tunnels.map((tunnel) => (
                  <TableRow key={tunnel.id}>
                    <TableCell>{typeLabel(tunnel.type)}</TableCell>
                    <TableCell>
                      {tunnel.localAddress}:{tunnel.localPort}
                    </TableCell>
                    <TableCell>
                      {tunnel.type !== 'dynamic'
                        ? `${tunnel.remoteAddress}:${tunnel.remotePort}`
                        : '-'}
                    </TableCell>
                    <TableCell>
                      <span
                        className={`text-xs ${tunnel.running ? 'text-green-400' : 'text-muted-foreground'}`}
                      >
                        {tunnel.running ? t('运行中') : t('已停止')}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      {tunnel.running ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          className="text-destructive"
                          onClick={() => onStop(tunnel.id)}
                        >
                          {t('停止')}
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() =>
                            onStart({
                              sessionId: tunnel.sessionId,
                              type: tunnel.type,
                              localAddress: tunnel.localAddress,
                              localPort: tunnel.localPort,
                              remoteAddress: tunnel.remoteAddress,
                              remotePort: tunnel.remotePort,
                            })
                          }
                        >
                          {t('启动')}
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

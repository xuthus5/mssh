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
import { normalizeTunnelLocalAddress, remoteTunnelExposureWarning, validateTunnelLocalAddress } from '@/lib/tunnelBind'
import { t } from '@/i18n'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  tunnels: Tunnel[]
  onStart: (tunnel: Omit<Tunnel, 'id' | 'running'> & { id?: string }) => void | Promise<void>
  onStop: (tunnelId: string) => void | Promise<void>
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
  const [error, setError] = useState('')
  const [pending, setPending] = useState(false)

  const resetForm = () => {
    setLocalAddress('')
    setLocalPort('')
    setRemoteAddress('')
    setRemotePort('')
    setError('')
    setShowAdd(false)
  }

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault()
    const bindError = validateTunnelLocalAddress(type, localAddress)
    if (bindError) {
      setError(t(bindError))
      return
    }
    setPending(true)
    setError('')
    try {
      await onStart({
        sessionId: _sessionId,
        type: type as Tunnel['type'],
        localAddress: normalizeTunnelLocalAddress(type, localAddress),
        localPort: parseInt(localPort, 10) || 0,
        remoteAddress: remoteAddress || '127.0.0.1',
        remotePort: parseInt(remotePort, 10) || 0,
      })
      resetForm()
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      setError(message)
    } finally {
      setPending(false)
    }
  }

  const typeLabel = (value: string) => {
    switch (value) {
      case 'local': return t('本地转发')
      case 'remote': return t('远程转发')
      case 'dynamic': return t('动态转发')
      default: return value
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
              onClick={() => {
                if (showAdd) resetForm()
                else setShowAdd(true)
              }}
            >
              {showAdd ? t('取消') : t('新建隧道')}
            </Button>
          </div>
          {showAdd && (
            <form onSubmit={handleSubmit} className="flex flex-col gap-3 rounded-lg border border-border p-3">
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">{t('类型')}</label>
                <LabeledSelect
                  value={type}
                  options={TUNNEL_TYPE_OPTIONS}
                  onValueChange={(value) => {
                    setType(value)
                    setError('')
                  }}
                />
              </div>
              {type !== 'dynamic' && (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{t('本地地址')}</label>
                      <Input
                        value={localAddress}
                        onChange={(e) => { setLocalAddress(e.target.value); setError('') }}
                        placeholder="127.0.0.1"
                        aria-label={t('本地地址')}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{t('本地端口')}</label>
                      <Input type="number" value={localPort} onChange={(e) => setLocalPort(e.target.value)} placeholder="8080" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{t('远程地址')}</label>
                      <Input value={remoteAddress} onChange={(e) => setRemoteAddress(e.target.value)} placeholder="127.0.0.1" />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <label className="text-xs font-medium text-muted-foreground">{t('远程端口')}</label>
                      <Input type="number" value={remotePort} onChange={(e) => setRemotePort(e.target.value)} placeholder="80" />
                    </div>
                  </div>
                </>
              )}
              {type === 'dynamic' && (
                <div className="grid grid-cols-2 gap-3">
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('本地地址')}</label>
                    <Input
                      value={localAddress}
                      onChange={(e) => { setLocalAddress(e.target.value); setError('') }}
                      placeholder="127.0.0.1"
                      aria-label={t('本地地址')}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label className="text-xs font-medium text-muted-foreground">{t('本地端口')}</label>
                    <Input type="number" value={localPort} onChange={(e) => setLocalPort(e.target.value)} placeholder="1080" />
                  </div>
                </div>
              )}
              {(type === 'local' || type === 'dynamic') && (
                <p className="text-xs text-muted-foreground">{t('本地/动态隧道仅允许绑定回环地址，避免意外对局域网暴露服务。')}</p>
              )}
              {type === 'remote' && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  {t(remoteTunnelExposureWarning('remote', remoteAddress)
                    ?? '远程转发会在 SSH 服务端打开监听端口；绑定非回环地址时请确认安全边界。')}
                </p>
              )}
              {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
              <DialogFooter showCloseButton>
                <Button type="submit" disabled={pending}>{pending ? t('启动中…') : t('启动')}</Button>
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
                  <TableCell colSpan={5} className="text-center text-muted-foreground">{t('无隧道')}</TableCell>
                </TableRow>
              ) : (
                tunnels.map((tunnel) => (
                  <TableRow key={tunnel.id}>
                    <TableCell>{typeLabel(tunnel.type)}</TableCell>
                    <TableCell className="font-mono text-xs">{tunnel.localAddress}:{tunnel.localPort}</TableCell>
                    <TableCell className="font-mono text-xs">
                      {tunnel.type !== 'dynamic' ? `${tunnel.remoteAddress}:${tunnel.remotePort}` : '-'}
                    </TableCell>
                    <TableCell>{tunnel.running ? t('运行中') : t('已停止')}</TableCell>
                    <TableCell className="text-right">
                      {tunnel.running ? (
                        <Button size="xs" variant="ghost" onClick={() => onStop(tunnel.id)}>{t('停止')}</Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => onStart({
                            id: tunnel.id,
                            sessionId: tunnel.sessionId,
                            type: tunnel.type,
                            localAddress: tunnel.localAddress,
                            localPort: tunnel.localPort,
                            remoteAddress: tunnel.remoteAddress,
                            remotePort: tunnel.remotePort,
                          })}
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

import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import type { Tunnel } from '@/hooks/useSession'
import { t } from '@/i18n'

type StartTunnel = (tunnel: Omit<Tunnel, 'id' | 'running'> & { id?: string }, options?: { silent?: boolean }) => void | Promise<void>
type RunAction = (action: () => void | Promise<void>, failure: string) => void

interface Props {
  disabled: boolean
  tunnels: Tunnel[]
  loadError: string
  onReload?: () => void | Promise<void>
  onStart: StartTunnel
  onStop: (tunnelID: string) => void | Promise<void>
  onStartAction: RunAction
  onStopAction: RunAction
  onDelete?: (tunnelID: string, label: string) => void
}

export function TunnelTable({ disabled, tunnels, loadError, onReload, onStart, onStop, onStartAction, onStopAction, onDelete }: Props) {
  return <Table>
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
      {loadError ? <TableRow><TableCell colSpan={5} className="text-center"><div className="flex flex-col items-center gap-2 py-2 text-sm text-destructive" role="alert"><span>{t('加载隧道失败: ${}', loadError)}</span>{onReload ? <Button size="xs" variant="outline" disabled={disabled} onClick={() => { void Promise.resolve(onReload()).catch(() => undefined) }}>{t('重试')}</Button> : null}</div></TableCell></TableRow> : tunnels.length === 0 ? <TableRow><TableCell colSpan={5} className="text-center text-muted-foreground">{t('无隧道')}</TableCell></TableRow> : tunnels.map((tunnel) => <TunnelRow key={tunnel.id} disabled={disabled} tunnel={tunnel} onStart={onStart} onStop={onStop} onStartAction={onStartAction} onStopAction={onStopAction} onDelete={onDelete} />)}
    </TableBody>
  </Table>
}

function TunnelRow({ disabled, tunnel, onStart, onStop, onStartAction, onStopAction, onDelete }: { disabled: boolean; tunnel: Tunnel; onStart: StartTunnel; onStop: (tunnelID: string) => void | Promise<void>; onStartAction: RunAction; onStopAction: RunAction; onDelete?: (tunnelID: string, label: string) => void }) {
  const label = typeLabel(tunnel.type)
  return <TableRow>
    <TableCell>{label}</TableCell>
    <TableCell className="font-mono text-xs">{tunnel.localAddress}:{tunnel.localPort}</TableCell>
    <TableCell className="font-mono text-xs">{tunnel.type !== 'dynamic' ? `${tunnel.remoteAddress}:${tunnel.remotePort}` : '-'}</TableCell>
    <TableCell>{tunnel.running ? t('运行中') : t('已停止')}</TableCell>
    <TableCell className="text-right"><div className="flex justify-end gap-1">
      {tunnel.running ? <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onStopAction(() => onStop(tunnel.id), '停止隧道失败: ${}')}>{t('停止')}</Button> : <Button size="xs" variant="ghost" disabled={disabled} onClick={() => onStartAction(() => onStart(tunnel), '启动隧道失败: ${}')}>{t('启动')}</Button>}
      {onDelete ? <Button size="xs" variant="ghost" disabled={disabled} className="text-destructive" onClick={() => onDelete(tunnel.id, `${label} ${tunnel.localAddress}:${tunnel.localPort}`)}>{t('删除')}</Button> : null}
    </div></TableCell>
  </TableRow>
}

function typeLabel(value: string) {
  switch (value) {
    case 'local': return t('本地转发')
    case 'remote': return t('远程转发')
    case 'dynamic': return t('动态转发')
    default: return value
  }
}

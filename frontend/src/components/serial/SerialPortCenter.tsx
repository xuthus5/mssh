import { useMemo, useState } from 'react'
import { Cable, PlugZap, RefreshCw, Search, Trash2 } from 'lucide-react'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { useSerial, type SerialPort } from '@/hooks/useSerial'
import { SerialPortDialog } from '@/components/serial/SerialPortDialog'
import { SerialPortTable } from '@/components/serial/SerialPortTable'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'

type DeleteTarget =
  | { kind: 'single'; port: SerialPort }
  | { kind: 'batch'; ids: number[]; count: number }
  | null

export function SerialPortCenter() {
  const {
    ports, devices, activeDevices, loading, error, refresh,
    createPort, updatePort, deletePort, deleteMany, duplicatePort, connectPort,
  } = useSerial()
  const [query, setQuery] = useState('')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editing, setEditing] = useState<SerialPort | null>(null)
  const [connectingID, setConnectingID] = useState<number | null>(null)
  const [deletingID, setDeletingID] = useState<number | null>(null)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [batchBusy, setBatchBusy] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) return ports
    return ports.filter((port) =>
      [port.name, port.device, port.notes, String(port.baud_rate), port.flow_control].join(' ').toLowerCase().includes(keyword),
    )
  }, [ports, query])

  const allFilteredSelected = filtered.length > 0 && filtered.every((port) => selected.has(Number(port.id)))
  const toggleAll = (checked: boolean) => setSelected(checked ? new Set(filtered.map((port) => Number(port.id))) : new Set())
  const toggleOne = (id: number, checked: boolean) => setSelected((prev) => {
    const next = new Set(prev)
    if (checked) next.add(id)
    else next.delete(id)
    return next
  })

  const save = async (input: Parameters<typeof createPort>[0]) => {
    if (input.id && Number(input.id) > 0) {
      await updatePort(input)
      toast(t('串口配置已更新'), 'success')
      return
    }
    await createPort({ ...input, id: 0 })
    toast(t('串口配置已创建'), 'success')
  }

  const connect = async (port: SerialPort) => {
    setConnectingID(Number(port.id))
    try {
      await connectPort(port)
      toast(t('串口已连接: ${}', port.name || port.device), 'success')
      await refresh()
    } catch {
      // toast handled in hook
    } finally {
      setConnectingID(null)
    }
  }

  const duplicate = async (port: SerialPort) => {
    try {
      await duplicatePort(port)
      toast(t('串口配置已复制'), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget) return
    if (deleteTarget.kind === 'single') {
      const id = Number(deleteTarget.port.id)
      setDeletingID(id)
      try {
        await deletePort(id)
        setSelected((prev) => {
          const next = new Set(prev)
          next.delete(id)
          return next
        })
        setDeleteTarget(null)
        toast(t('串口配置已删除'), 'success')
      } catch (err) {
        toast(err instanceof Error ? err.message : String(err), 'error')
      } finally {
        setDeletingID(null)
      }
      return
    }
    setBatchBusy(true)
    try {
      await deleteMany(deleteTarget.ids)
      setSelected(new Set())
      setDeleteTarget(null)
      toast(t('已删除 ${} 个串口配置', String(deleteTarget.count)), 'success')
    } catch (err) {
      toast(err instanceof Error ? err.message : String(err), 'error')
    } finally {
      setBatchBusy(false)
    }
  }

  const deletePending = deletingID !== null || batchBusy

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-auto bg-background p-5">
      <header className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Cable className="size-5 text-primary" />
          <div>
            <h1 className="text-xl font-semibold">{t('串口管理')}</h1>
            <p className="text-sm text-muted-foreground">{t('管理串口设备配置，并一键打开串口终端')}</p>
          </div>
          <Badge variant="secondary" className="ml-1">{ports.length} {t('个配置')}</Badge>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button type="button" variant="outline" size="sm" onClick={() => void refresh()} disabled={loading}>
            <RefreshCw data-icon="inline-start" className={loading ? 'animate-spin' : undefined} />
            {t('刷新设备')}
          </Button>
          <Button type="button" size="sm" onClick={() => { setEditing(null); setDialogOpen(true) }}>{t('新建串口配置')}</Button>
        </div>
      </header>

      {error ? (
        <Alert variant="destructive" className="mb-4">
          <AlertDescription>
            {error}
            <Button size="xs" variant="outline" className="ml-3" onClick={() => void refresh()}>{t('重试')}</Button>
          </AlertDescription>
        </Alert>
      ) : null}

      <Card>
        <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-3 space-y-0">
          <CardTitle className="text-sm">{t('串口配置列表')}</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            {selected.size > 0 ? (
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={batchBusy}
                onClick={() => setDeleteTarget({ kind: 'batch', ids: [...selected], count: selected.size })}
              >
                <Trash2 data-icon="inline-start" />
                {t('批量删除')} ({selected.size})
              </Button>
            ) : null}
            <div className="relative w-64 max-w-full">
              <Search className="absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t('搜索串口配置...')} className="h-8 pl-7 text-xs" />
            </div>
          </div>
        </CardHeader>
        <CardContent>
          <div className="mb-3 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <PlugZap className="size-3.5" />
            {devices.length > 0 ? t('检测到 ${} 个串口设备', String(devices.length)) : t('未检测到设备，仍可手动填写路径')}
            {devices.slice(0, 6).map((device) => (
              <Badge key={device} variant="outline" className="font-mono text-[10px]">{device}</Badge>
            ))}
          </div>
          <SerialPortTable
            ports={ports}
            filtered={filtered}
            devices={devices}
            activeDevices={activeDevices}
            selected={selected}
            connectingID={connectingID}
            deletingID={deletingID}
            allFilteredSelected={allFilteredSelected}
            onToggleAll={toggleAll}
            onToggleOne={toggleOne}
            onConnect={(port) => void connect(port)}
            onEdit={(port) => { setEditing(port); setDialogOpen(true) }}
            onDuplicate={(port) => void duplicate(port)}
            onRemove={(port) => setDeleteTarget({ kind: 'single', port })}
          />
        </CardContent>
      </Card>

      <SerialPortDialog open={dialogOpen} onOpenChange={setDialogOpen} port={editing} devices={devices} onSave={save} />
      <SerialDeleteDialog
        target={deleteTarget}
        pending={deletePending}
        onOpenChange={(open) => { if (!open && !deletePending) setDeleteTarget(null) }}
        onConfirm={() => { void confirmDelete() }}
      />
    </section>
  )
}

function SerialDeleteDialog({
  target,
  pending,
  onOpenChange,
  onConfirm,
}: {
  target: DeleteTarget
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const title = target?.kind === 'single'
    ? t('确认删除串口配置「${}」？', target.port.name)
    : t('确认删除选中的 ${} 个串口配置？', String(target?.count ?? 0))
  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{title}</AlertDialogTitle>
          <AlertDialogDescription>{t('此操作不可撤销。')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={pending} onClick={onConfirm}>
            {pending ? t('删除中…') : t('确认删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

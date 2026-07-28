import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Plus, Trash2 } from 'lucide-react'
import { requestConfirm } from '@/lib/confirmDialog'
import { t } from '@/i18n'

export interface CommandItem {
  id: string
  name: string
  shortcut: string
  command: string
}

interface Props {
  commands: CommandItem[]
  onExecute: (command: string) => void
  onAdd: (item: Omit<CommandItem, 'id'>) => void | Promise<void>
  onDelete: (id: string) => void | Promise<void>
  showAddForm?: boolean
  mutationDisabled?: boolean
}

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}

function useAddCommand(lifecycle: MutableRefObject<number>, onAdd: Props['onAdd'], mutationDisabled: boolean) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [command, setCommand] = useState('')
  const [adding, setAdding] = useState(false)
  const formGeneration = useRef(0)
  const addRequest = useRef(0)
  const addActive = useRef(false)
  const changeAddForm = (open: boolean) => {
    if (mutationDisabled || addActive.current) return
    formGeneration.current++
    setShowAdd(open)
  }

  const handleAdd = async () => {
    if (mutationDisabled || !name.trim() || !command.trim() || addActive.current) return
    addActive.current = true
    const lifecycleToken = lifecycle.current
    const generation = formGeneration.current
    const request = ++addRequest.current
    const isLatest = () => lifecycle.current === lifecycleToken && addRequest.current === request
    const isCurrent = () => isLatest() && formGeneration.current === generation
    setAdding(true)
    try {
      await onAdd({ name: name.trim(), shortcut: shortcut.trim(), command: command.trim() })
      if (!isCurrent()) return
      setName('')
      setShortcut('')
      setCommand('')
      setShowAdd(false)
    } catch {
      // parent surfaces fixed-surface error; keep form open for retry
    } finally {
      if (isLatest()) {
        addActive.current = false
        setAdding(false)
      }
    }
  }
  return { showAdd, name, shortcut, command, adding, mutationDisabled, setName, setShortcut, setCommand, changeAddForm, handleAdd }
}

interface DeleteCommandOptions {
  lifecycle: MutableRefObject<number>
  commands: CommandItem[]
  onDelete: Props['onDelete']
  mutationDisabled: boolean
}

function useDeleteCommand(options: DeleteCommandOptions) {
  const deleteGeneration = useRef(0)
  const deleteRequest = useRef(0)
  const deleteActive = useRef(false)
  const [deletingID, setDeletingID] = useState<string | null>(null)
  const commandKey = options.commands.map((item) => item.id).join('\u0000')
  useEffect(() => { deleteGeneration.current++ }, [commandKey])
  const handleDelete = async (item: CommandItem) => {
    if (options.mutationDisabled || deleteActive.current) return
    deleteActive.current = true
    const lifecycleToken = options.lifecycle.current
    const generation = deleteGeneration.current
    const request = ++deleteRequest.current
    const isLatest = () => options.lifecycle.current === lifecycleToken && deleteRequest.current === request
    const isCurrent = () => isLatest() && deleteGeneration.current === generation
    setDeletingID(item.id)
    try {
      const confirmed = await requestConfirm({
        title: t('删除宏'),
        description: t('确认删除宏「${}」？此操作不可撤销。', item.name),
        confirmLabel: t('删除'),
        cancelLabel: t('取消'),
        destructive: true,
      })
      if (!confirmed || !isCurrent()) return
      await options.onDelete(item.id)
    } catch {
      // parent surfaces fixed-surface error
    } finally {
      if (isLatest()) {
        deleteActive.current = false
        setDeletingID(null)
      }
    }
  }
  return { deletingID, handleDelete }
}

type AddCommandState = ReturnType<typeof useAddCommand>

function QuickCommandAddForm({ state }: { state: AddCommandState }) {
  if (!state.showAdd) return null
  const disabled = state.adding || state.mutationDisabled
  return <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-border p-2">
    <Input disabled={disabled} placeholder={t('名称')} value={state.name} onChange={(event) => state.setName(event.target.value)} className="h-7 text-xs" />
    <Input disabled={disabled} placeholder={t('快捷键 (可选)')} value={state.shortcut} onChange={(event) => state.setShortcut(event.target.value)} className="h-7 text-xs" />
    <Input disabled={disabled} placeholder={t('命令')} value={state.command} onChange={(event) => state.setCommand(event.target.value)} className="h-7 text-xs" />
    <div className="flex justify-end gap-1">
      <Button size="xs" variant="ghost" disabled={disabled} onClick={() => state.changeAddForm(false)}>{t('取消')}</Button>
      <Button size="xs" disabled={disabled} onClick={() => { void state.handleAdd() }}>{state.adding ? t('添加中...') : t('添加')}</Button>
    </div>
  </div>
}

function QuickCommandRow({ item, deleteBusy, onExecute, onDelete }: {
  item: CommandItem
  deleteBusy: boolean
  onExecute: Props['onExecute']
  onDelete: (item: CommandItem) => void
}) {
  return <div role="button" tabIndex={0} aria-label={t('执行宏 ${}', item.name)}
    className="group flex cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-muted/50" draggable
    onDragStart={(event) => { event.dataTransfer.setData('text/plain', item.command) }}
    onClick={() => onExecute(item.command)}
    onKeyDown={(event) => {
      if (event.key !== 'Enter' && event.key !== ' ') return
      event.preventDefault()
      onExecute(item.command)
    }}>
    <div className="min-w-0 flex-1">
      <div className="truncate text-xs">{item.name}</div>
      <div className="truncate text-[10px] text-muted-foreground">{item.command}</div>
    </div>
    {item.shortcut ? <span className="flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{item.shortcut}</span> : null}
    <Button size="xs" variant="ghost" disabled={deleteBusy} aria-label={t('删除 ${}', item.name)}
      className="opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
      onClick={(event) => { event.stopPropagation(); onDelete(item) }}>
      <Trash2 className="h-3 w-3" />
    </Button>
  </div>
}

function QuickCommandList({ commands, deletingID, mutationDisabled, onExecute, onDelete }: {
  commands: CommandItem[]
  deletingID: string | null
  mutationDisabled: boolean
  onExecute: Props['onExecute']
  onDelete: (item: CommandItem) => void
}) {
  if (commands.length === 0) return <p className="px-1 text-xs text-muted-foreground">{t('暂无快捷命令')}</p>
  return <div className="flex flex-col gap-0.5">
    {commands.map((item) => <QuickCommandRow key={item.id} item={item} deleteBusy={mutationDisabled || deletingID !== null}
      onExecute={onExecute} onDelete={onDelete} />)}
  </div>
}

export default function QuickCommands({ commands, onExecute, onAdd, onDelete, showAddForm = true, mutationDisabled = false }: Props) {
  const lifecycle = useLifecycleRef()
  const addState = useAddCommand(lifecycle, onAdd, mutationDisabled)
  const deleteState = useDeleteCommand({ lifecycle, commands, onDelete, mutationDisabled })
  return <div className="flex h-full flex-col p-2">
    <div className="mb-2 flex items-center justify-between">
      <span className="text-xs font-medium text-muted-foreground">{t('快捷命令')}</span>
      {showAddForm ? <Button size="xs" variant="ghost" disabled={mutationDisabled || addState.adding} aria-label={t('添加快捷命令')} onClick={() => addState.changeAddForm(!addState.showAdd)}><Plus /></Button> : null}
    </div>
    <QuickCommandAddForm state={addState} />
    <div className="min-h-0 flex-1 overflow-y-auto">
      <QuickCommandList commands={commands} deletingID={deleteState.deletingID} mutationDisabled={mutationDisabled} onExecute={onExecute}
        onDelete={(item) => { void deleteState.handleDelete(item) }} />
    </div>
  </div>
}

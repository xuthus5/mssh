import { useState } from 'react'
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
  onAdd: (item: Omit<CommandItem, 'id'>) => void
  onDelete: (id: string) => void | Promise<void>
  showAddForm?: boolean
}

export default function QuickCommands({
  commands,
  onExecute,
  onAdd,
  onDelete,
  showAddForm = true,
}: Props) {
  const [showAdd, setShowAdd] = useState(false)
  const [name, setName] = useState('')
  const [shortcut, setShortcut] = useState('')
  const [command, setCommand] = useState('')

  const handleAdd = () => {
    if (!name.trim() || !command.trim()) return
    onAdd({ name: name.trim(), shortcut: shortcut.trim(), command: command.trim() })
    setName('')
    setShortcut('')
    setCommand('')
    setShowAdd(false)
  }

  const handleDelete = async (item: CommandItem) => {
    const ok = await requestConfirm({
      title: t('删除宏'),
      description: t('确认删除宏「${}」？此操作不可撤销。', item.name),
      confirmLabel: t('删除'),
      cancelLabel: t('取消'),
      destructive: true,
    })
    if (!ok) return
    try {
      await onDelete(item.id)
    } catch {
      // parent surfaces toast
    }
  }

  return (
    <div className="flex h-full flex-col p-2">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{t('快捷命令')}</span>
        {showAddForm && (
          <Button size="xs" variant="ghost" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>
      {showAdd && (
        <div className="mb-2 flex flex-col gap-1.5 rounded-lg border border-border p-2">
          <Input placeholder={t('名称')} value={name} onChange={(e) => setName(e.target.value)} className="h-7 text-xs" />
          <Input placeholder={t('快捷键 (可选)')} value={shortcut} onChange={(e) => setShortcut(e.target.value)} className="h-7 text-xs" />
          <Input placeholder={t('命令')} value={command} onChange={(e) => setCommand(e.target.value)} className="h-7 text-xs" />
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setShowAdd(false)}>{t('取消')}</Button>
            <Button size="xs" onClick={handleAdd}>{t('添加')}</Button>
          </div>
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {commands.length === 0 ? (
          <p className="px-1 text-xs text-muted-foreground">{t('暂无快捷命令')}</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {commands.map((item) => (
              <div
                key={item.id}
                className="group flex cursor-pointer items-center gap-1 rounded px-2 py-1 hover:bg-muted/50"
                draggable
                onDragStart={(e) => { e.dataTransfer.setData('text/plain', item.command) }}
                onClick={() => onExecute(item.command)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-xs">{item.name}</div>
                  <div className="truncate text-[10px] text-muted-foreground">{item.command}</div>
                </div>
                {item.shortcut ? (
                  <span className="flex-shrink-0 rounded bg-muted px-1 py-0.5 text-[10px] text-muted-foreground">{item.shortcut}</span>
                ) : null}
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={t('删除 ${}', item.name)}
                  className="opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    void handleDelete(item)
                  }}
                >
                  <Trash2 className="h-3 w-3" />
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

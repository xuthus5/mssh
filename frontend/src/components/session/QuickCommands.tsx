import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { Play, Plus, Trash2 } from 'lucide-react'

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
  onDelete: (id: string) => void
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

  return (
    <div className="flex flex-col h-full p-2">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-medium text-muted-foreground">
          快捷命令
        </span>
        {showAddForm && (
          <Button size="xs" variant="ghost" onClick={() => setShowAdd(!showAdd)}>
            <Plus className="h-3 w-3" />
          </Button>
        )}
      </div>
      {showAdd && (
        <div className="flex flex-col gap-1.5 mb-2 p-2 rounded-lg border border-border">
          <Input
            placeholder="名称"
            value={name}
            onChange={(e) => setName(e.target.value)}
            className="text-xs h-7"
          />
          <Input
            placeholder="快捷键 (可选)"
            value={shortcut}
            onChange={(e) => setShortcut(e.target.value)}
            className="text-xs h-7"
          />
          <Input
            placeholder="命令"
            value={command}
            onChange={(e) => setCommand(e.target.value)}
            className="text-xs h-7"
          />
          <div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" onClick={() => setShowAdd(false)}>
              取消
            </Button>
            <Button size="xs" onClick={handleAdd}>
              添加
            </Button>
          </div>
        </div>
      )}
      <div className="flex-1 overflow-y-auto min-h-0">
        {commands.length === 0 ? (
          <p className="text-xs text-muted-foreground px-1">暂无快捷命令</p>
        ) : (
          <div className="flex flex-col gap-0.5">
            {commands.map((item) => (
              <div
                key={item.id}
                className="group flex items-center gap-1 px-2 py-1 rounded hover:bg-muted/50 cursor-pointer"
                draggable
                onDragStart={(e) => {
                  e.dataTransfer.setData('text/plain', item.command)
                }}
                onClick={() => onExecute(item.command)}
              >
                <div className="flex-1 min-w-0">
                  <div className="text-xs truncate">{item.name}</div>
                  <div className="text-[10px] text-muted-foreground truncate">
                    {item.command}
                  </div>
                </div>
                {item.shortcut && (
                  <span className="text-[10px] px-1 py-0.5 rounded bg-muted text-muted-foreground flex-shrink-0">
                    {item.shortcut}
                  </span>
                )}
                <Button
                  size="xs"
                  variant="ghost"
                  className="opacity-100 transition-opacity focus-within:opacity-100 sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  onClick={(e) => {
                    e.stopPropagation()
                    onDelete(item.id)
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

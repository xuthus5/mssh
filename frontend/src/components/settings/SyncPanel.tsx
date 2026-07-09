import { useState, type FormEvent } from 'react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { SyncConfig } from '@/hooks/useSettings'

interface Props {
  sync: SyncConfig
  onSave: (c: SyncConfig) => void
  onExport: () => void
  onImport: () => void
}

export function SyncPanel({ sync, onSave, onExport, onImport }: Props) {
  const [enabled, setEnabled] = useState(sync.enabled)
  const [url, setUrl] = useState(sync.url)
  const [username, setUsername] = useState(sync.username)
  const [password, setPassword] = useState(sync.password)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    onSave({ enabled, url, username, password })
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" onClick={onExport}>
            导出配置
          </Button>
          <span className="text-xs text-muted-foreground">
            保存当前设置为文件
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" onClick={onImport}>
            导入配置
          </Button>
          <span className="text-xs text-muted-foreground">
            从文件加载设置
          </span>
        </div>
      </div>
      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-medium mb-3">云同步</h4>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={enabled}
              onCheckedChange={(checked) =>
                setEnabled(checked === true)
              }
            />
            <label className="text-sm cursor-pointer">启用云同步</label>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              同步 URL
            </label>
            <Input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://sync.example.com/api"
              disabled={!enabled}
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                用户名
              </label>
              <Input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                disabled={!enabled}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                密码
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                disabled={!enabled}
              />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="submit" size="sm" disabled={!enabled}>
              保存同步配置
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

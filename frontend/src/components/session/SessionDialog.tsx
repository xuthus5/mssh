import { useState, useCallback, useEffect } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Button } from '@/components/ui/button'
import { KeyService } from '@/lib/wails'
import type { Session, Folder } from '@/hooks/useSession'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  folders?: Folder[]
  onSave: (data: Omit<Session, 'id'>) => void
}

interface KeyItem { id: number; name: string; type: string }

const AUTH_LABELS: Record<string, string> = {
  password: '密码',
  'keyboard-interactive': '交互式认证',
  key: '密钥',
  agent: 'SSH Agent',
}

const TERM_TYPES = [
  'xterm-256color',
  'xterm',
  'vt100',
  'vt220',
  'linux',
  'ansi',
]

function AuthValue({ value }: { value: string }) {
  return <span>{AUTH_LABELS[value] ?? value}</span>
}

export default function SessionDialog({ open, onOpenChange, session, folders, onSave }: Props) {
  const [name, setName] = useState(session?.name ?? '')
  const [host, setHost] = useState(session?.host ?? '')
  const [port, setPort] = useState(session?.port?.toString() ?? '22')
  const [username, setUsername] = useState(session?.username ?? '')
  const [authMethod, setAuthMethod] = useState<string>(session?.authMethod ?? 'password')
  const [password, setPassword] = useState(session?.password ?? '')
  const [keyId, setKeyId] = useState<string>(session?.keyId ?? '')
  const [keepAlive, setKeepAlive] = useState(session?.keepAlive?.toString() ?? '60')
  const [termType, setTermType] = useState(session?.termType ?? 'xterm-256color')
  const [folderId, setFolderId] = useState(session?.folderId ?? '')

  const [keys, setKeys] = useState<KeyItem[]>([])

  useEffect(() => {
    if (!open) return
    KeyService.List()
      .then((list) => setKeys(list as KeyItem[]))
      .catch(() => setKeys([]))
  }, [open])

  const handleSubmit = useCallback(() => {
    const needsPassword = authMethod === 'password' || authMethod === 'keyboard-interactive'
    onSave({
      name: name.trim(),
      host: host.trim(),
      port: parseInt(port, 10) || 22,
      username: username.trim(),
      authMethod: authMethod as Session["authMethod"],
      password: needsPassword ? password : undefined,
      keyId: authMethod === 'key' ? keyId : undefined,
      keepAlive: parseInt(keepAlive, 10) || 60,
      termType: termType.trim() || 'xterm-256color',
      folderId: folderId || null,
    })
    onOpenChange(false)
  }, [name, host, port, username, authMethod, password, keyId, keepAlive, termType, folderId, onSave, onOpenChange])

  const isEditing = !!session

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑会话' : '新建会话'}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
          className="flex flex-col gap-3"
        >
          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">名称</span>
            <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">主机</span>
              <Input value={host} onChange={(e) => setHost(e.target.value)} required placeholder="192.168.1.1" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">端口</span>
              <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required min={1} max={65535} />
            </label>
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">用户名</span>
            <Input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="root" />
          </label>

          <label className="flex flex-col gap-1.5">
            <span className="text-xs font-medium text-muted-foreground">认证方式</span>
            <Select value={authMethod} onValueChange={(v) => setAuthMethod(v ?? 'password')}>
              <SelectTrigger className="w-full">
                <SelectValue>
                  <AuthValue value={authMethod} />
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">密码</SelectItem>
                <SelectItem value="keyboard-interactive">交互式认证</SelectItem>
                <SelectItem value="key">密钥</SelectItem>
                <SelectItem value="agent">SSH Agent</SelectItem>
              </SelectContent>
            </Select>
          </label>

          {(authMethod === 'password' || authMethod === 'keyboard-interactive') && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">密码</span>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="输入SSH密码" />
            </label>
          )}

          {authMethod === 'key' && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">SSH 密钥</span>
              {keys.length === 0 ? (
                <div className="text-xs text-muted-foreground py-2 px-3 border rounded-lg border-dashed">
                  暂无可用密钥，请先在设置 → 密钥管理中导入
                </div>
              ) : (
                <Select value={keyId} onValueChange={(v) => setKeyId(v ?? '')}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="选择密钥..." />
                  </SelectTrigger>
                  <SelectContent>
                    {keys.map((k) => (
                      <SelectItem key={String(k.id)} value={String(k.id)}>
                        {k.name} <span className="text-muted-foreground ml-1 text-xs">({k.type})</span>
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </label>
          )}

          {folders && folders.length > 0 && (
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">分组</span>
              <Select value={folderId} onValueChange={(v) => setFolderId(v ?? '')}>
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="无分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无分组</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          )}

          <div className="grid grid-cols-2 gap-3">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">保活间隔 (秒)</span>
              <Input type="number" value={keepAlive} onChange={(e) => setKeepAlive(e.target.value)} min={0} />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">终端类型</span>
              <Select value={termType} onValueChange={(v) => setTermType(v ?? 'xterm-256color')}>
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TERM_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </label>
          </div>

          <DialogFooter showCloseButton>
            <Button onClick={handleSubmit}>{isEditing ? '保存' : '创建连接'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

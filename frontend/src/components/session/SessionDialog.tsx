import { useState } from 'react'
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
import type { Session, Folder } from '@/hooks/useSession'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  folders?: Folder[]
  onSave: (data: Omit<Session, 'id'>) => void
}

export default function SessionDialog({
  open,
  onOpenChange,
  session,
  folders,
  onSave,
}: Props) {
  const [name, setName] = useState(session?.name ?? '')
  const [host, setHost] = useState(session?.host ?? '')
  const [port, setPort] = useState(session?.port?.toString() ?? '22')
  const [username, setUsername] = useState(session?.username ?? '')
  const [authMethod, setAuthMethod] = useState<string>(
    session?.authMethod ?? 'password',
  )
  const [password, setPassword] = useState(session?.password ?? '')
  const [keyId, setKeyId] = useState(session?.keyId ?? '')
  const [keepAlive, setKeepAlive] = useState(
    session?.keepAlive?.toString() ?? '60',
  )
  const [termType, setTermType] = useState(session?.termType ?? 'xterm-256color')
  const [folderId, setFolderId] = useState<string>(session?.folderId ?? '')

  const handleSubmit = () => {
    const formData = { name, host, port, username, authMethod, keepAlive, termType }
    console.log('[SessionDialog] handleSubmit', formData)
    onSave({
      name,
      host,
      port: parseInt(port, 10) || 22,
      username,
      authMethod: authMethod as Session['authMethod'],
      password: authMethod === 'password' ? password : undefined,
      keyId: authMethod === 'key' ? keyId : undefined,
      keepAlive: parseInt(keepAlive, 10) || 60,
      termType,
      folderId: folderId || null,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{session ? '编辑会话' : '新建会话'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={(e) => { e.preventDefault(); handleSubmit() }} className="flex flex-col gap-3">
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              名称
            </label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                主机
              </label>
              <Input
                value={host}
                onChange={(e) => setHost(e.target.value)}
                required
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                端口
              </label>
              <Input
                type="number"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                required
              />
            </div>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              用户名
            </label>
            <Input
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              required
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              认证方式
            </label>
            <Select
              value={authMethod}
              onValueChange={(value) =>
                setAuthMethod(value ?? '')
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="password">密码</SelectItem>
                <SelectItem value="key">密钥</SelectItem>
                <SelectItem value="agent">SSH Agent</SelectItem>
                <SelectItem value="keyboard-interactive">交互式认证</SelectItem>
              </SelectContent>
            </Select>
          </div>
          {authMethod === 'password' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                密码
              </label>
              <Input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          )}
          {authMethod === 'key' && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                密钥 ID
              </label>
              <Input
                value={keyId}
                onChange={(e) => setKeyId(e.target.value)}
              />
            </div>
          )}
          {folders && folders.length > 0 && (
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                分组
              </label>
              <Select
                value={folderId}
                onValueChange={(value) => setFolderId(value ?? '')}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="无分组" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="">无分组</SelectItem>
                  {folders.map((f) => (
                    <SelectItem key={f.id} value={f.id}>
                      {f.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                保活间隔 (秒)
              </label>
              <Input
                type="number"
                value={keepAlive}
                onChange={(e) => setKeepAlive(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                终端类型
              </label>
              <Input
                value={termType}
                onChange={(e) => setTermType(e.target.value)}
              />
            </div>
          </div>
          <DialogFooter showCloseButton>
            <Button onClick={handleSubmit}>
              {session ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

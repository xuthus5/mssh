import { useState, type FormEvent } from 'react'
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
import type { Session } from '@/hooks/useSession'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  onSave: (data: Omit<Session, 'id'>) => void
}

export default function SessionDialog({
  open,
  onOpenChange,
  session,
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

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
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
      folderId: session?.folderId ?? null,
    })
    onOpenChange(false)
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{session ? '编辑会话' : '新建会话'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
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
            <Button type="submit">
              {session ? '保存' : '创建'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

import { useState, useCallback, useEffect, type ReactNode } from 'react'
import { CircleHelp } from 'lucide-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Textarea } from '@/components/ui/textarea'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { KeyService } from '@/lib/wails'
import type { Session, Folder } from '@/hooks/useSession'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  folders?: Folder[]
  onSave: (data: Omit<Session, 'id'>) => Promise<void>
}

interface KeyItem { id: number; name: string; type: string }

const AUTH_OPTIONS = [
  { value: 'password', label: '密码' },
  { value: 'keyboard-interactive', label: '交互式认证' },
  { value: 'key', label: '密钥' },
  { value: 'agent', label: 'SSH Agent' },
]

const TERM_TYPES = [
  'xterm-256color',
  'xterm',
  'vt100',
  'vt220',
  'linux',
  'ansi',
]

function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <fieldset className="rounded-xl border border-border bg-card px-3 pb-3 pt-2 shadow-sm">
      <legend className="px-1 text-xs font-semibold text-foreground">{title}</legend>
      <div className="flex flex-col gap-3">{children}</div>
    </fieldset>
  )
}

export default function SessionDialog({ open, onOpenChange, session, folders, onSave }: Props) {
  const [name, setName] = useState(session?.name ?? '')
  const [host, setHost] = useState(session?.host ?? '')
  const [port, setPort] = useState(session?.port?.toString() ?? '22')
  const [username, setUsername] = useState(session?.username ?? '')
  const [tags, setTags] = useState(session?.tags ?? '')
  const [notes, setNotes] = useState(session?.notes ?? '')
  const [environment, setEnvironment] = useState(session?.environment ?? '')
  const [project, setProject] = useState(session?.project ?? '')
  const [authMethod, setAuthMethod] = useState<string>(session?.authMethod ?? 'password')
  const [password, setPassword] = useState(session?.password ?? '')
  const [keyId, setKeyId] = useState<string>(session?.keyId ?? '')
  const [keepAlive, setKeepAlive] = useState(session?.keepAlive?.toString() ?? '0')
  const [termType, setTermType] = useState(session?.termType ?? 'xterm-256color')
  const defaultFolderID = folders?.find((folder) => folder.isDefault)?.id ?? ''
  const folderOptions = (folders ?? []).map((folder) => ({
    value: folder.id,
    label: `${folder.name}${folder.isDefault ? '（默认）' : ''}`,
  }))
  const termOptions = TERM_TYPES.map((termTypeOption) => ({ value: termTypeOption, label: termTypeOption }))
  const [folderId, setFolderId] = useState(session?.folderId ?? defaultFolderID)

  useEffect(() => {
    if (open) setFolderId(session?.folderId ?? defaultFolderID)
  }, [open, session?.folderId, defaultFolderID])

  const [keys, setKeys] = useState<KeyItem[]>([])
  const keyOptions = keys.map((key) => ({ value: String(key.id), label: `${key.name} (${key.type})` }))
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState('')

  useEffect(() => {
    if (!open) return
    KeyService.List()
      .then((list) => setKeys(list as KeyItem[]))
      .catch(() => setKeys([]))
  }, [open])

  const handleSubmit = useCallback(async () => {
    const needsPassword = authMethod === 'password' || authMethod === 'keyboard-interactive'
    setPending(true)
    setSubmitError('')
    try {
      await onSave({
        name: name.trim(), host: host.trim(), port: parseInt(port, 10) || 22,
        username: username.trim(), authMethod: authMethod as Session["authMethod"],
        tags: tags.trim(), notes: notes.trim(), environment: environment.trim(), project: project.trim(),
        password: needsPassword ? password : undefined, keyId: authMethod === 'key' ? keyId : undefined,
        keepAlive: Math.max(0, Number.parseInt(keepAlive, 10) || 0), termType: termType.trim() || 'xterm-256color', folderId: folderId || null,
      })
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err))
    } finally {
      setPending(false)
    }
  }, [name, host, port, username, tags, notes, environment, project, authMethod, password, keyId, keepAlive, termType, folderId, onSave])

  const isEditing = !!session

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? '编辑会话' : '新建会话'}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
          className="flex flex-col gap-3"
        >
          {submitError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{submitError}</div>}
          <FormSection title="连接与认证">
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">名称</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">主机</span>
                <Input value={host} onChange={(e) => setHost(e.target.value)} required placeholder="192.168.1.1" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">端口</span>
                <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required min={1} max={65535} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">用户名</span>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="root" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">认证方式</span>
                <LabeledSelect value={authMethod} options={AUTH_OPTIONS} onValueChange={setAuthMethod} />
              </label>
            </div>
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
                  <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    暂无可用密钥，请先在总览 → 密钥配置中导入
                  </div>
                ) : (
                  <LabeledSelect value={keyId} options={keyOptions} onValueChange={setKeyId} placeholder="选择密钥..." />
                )}
              </label>
            )}
          </FormSection>

          <FormSection title="资产归属">
            {folders && folders.length > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">分组</span>
                <LabeledSelect value={folderId} options={folderOptions} onValueChange={setFolderId} placeholder="无分组" />
              </label>
            )}
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">环境</span>
                <Input value={environment} onChange={(event) => setEnvironment(event.target.value)} placeholder="生产 / 测试" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">项目</span>
                <Input value={project} onChange={(event) => setProject(event.target.value)} placeholder="项目名称" />
              </label>
            </div>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">标签</span>
              <Input value={tags} onChange={(event) => setTags(event.target.value)} placeholder="数据库, 核心服务, 运维" />
            </label>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">备注</span>
              <Textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录用途、负责人或注意事项" rows={2} />
            </label>
          </FormSection>

          <FormSection title="终端选项">
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor="session-keep-alive" className="text-xs font-medium text-muted-foreground">保活间隔 (秒，0 使用全局默认)</label>
                  <Tooltip>
                    <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label="会话保活说明" />}>
                      <CircleHelp />
                    </TooltipTrigger>
                    <TooltipContent>会话保活仅维持底层 SSH 连接，不能控制服务端 Shell 的空闲自动登出策略。</TooltipContent>
                  </Tooltip>
                </div>
                <Input id="session-keep-alive" type="number" value={keepAlive} onChange={(e) => setKeepAlive(e.target.value)} min={0} />
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">终端类型</span>
                <LabeledSelect value={termType} options={termOptions} onValueChange={setTermType} />
              </label>
            </div>
          </FormSection>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>{pending ? '保存中...' : isEditing ? '保存' : '创建会话'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

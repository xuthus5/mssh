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
import type { AssetEnvironment, AssetProject, AssetTag, Session, Folder } from '@/hooks/useSession'
import type { AssetColorToken } from '@/lib/sessionModels'
import { SessionAssetFields } from '@/components/session/SessionAssetFields'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  folders?: Folder[]
  environments: AssetEnvironment[]
  projects: AssetProject[]
  assetTags: AssetTag[]
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
  onSave: (data: Omit<Session, 'id'>) => Promise<void>
}

interface KeyItem { id: number; name: string; type: string }

const AUTH_OPTIONS = [
  { value: 'password', label: t('密码') },
  { value: 'keyboard-interactive', label: t('交互式认证') },
  { value: 'key', label: t('密钥') },
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

export default function SessionDialog({ open, onOpenChange, session, folders, environments, projects, assetTags, onCreateEnvironment, onCreateProject, onCreateTag, onSave }: Props) {
  const [name, setName] = useState(session?.name ?? '')
  const [host, setHost] = useState(session?.host ?? '')
  const [port, setPort] = useState(session?.port?.toString() ?? '22')
  const [username, setUsername] = useState(session?.username ?? '')
  const [notes, setNotes] = useState(session?.notes ?? '')
  const [environmentId, setEnvironmentId] = useState(session?.environmentId ?? '')
  const [projectId, setProjectId] = useState(session?.projectId ?? '')
  const [tagIds, setTagIds] = useState(() => (session?.tags ?? []).map((tag) => tag.id))
  const [authMethod, setAuthMethod] = useState<string>(session?.authMethod ?? 'password')
  const [password, setPassword] = useState(session?.password ?? '')
  const [keyId, setKeyId] = useState<string>(session?.keyId ?? '')
  const [keepAlive, setKeepAlive] = useState(session?.keepAlive?.toString() ?? '0')
  const [termType, setTermType] = useState(session?.termType ?? 'xterm-256color')
  const defaultFolderID = folders?.find((folder) => folder.isDefault)?.id ?? ''
  const folderOptions = (folders ?? []).map((folder) => ({
    value: folder.id,
    label: `${folder.name}${folder.isDefault ? t('（默认）') : ''}`,
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
      .catch((error: unknown) => {
        setKeys([])
        toast(t('加载密钥列表失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
      })
  }, [open])

  const handleSubmit = useCallback(async () => {
    const needsPassword = authMethod === 'password' || authMethod === 'keyboard-interactive'
    setPending(true)
    setSubmitError('')
    try {
      await onSave({
        name: name.trim(), host: host.trim(), port: parseInt(port, 10) || 22,
        username: username.trim(), authMethod: authMethod as Session["authMethod"],
        tags: assetTags.filter((tag) => tagIds.includes(tag.id)), notes: notes.trim(), environmentId: environmentId || undefined, projectId: projectId || undefined,
        password: needsPassword ? password : undefined, keyId: authMethod === 'key' ? keyId : undefined,
        keepAlive: Math.max(0, Number.parseInt(keepAlive, 10) || 0), termType: termType.trim() || 'xterm-256color', folderId: folderId || null,
      })
      onOpenChange(false)
    } catch (err) {
      // workspace create/update already toast; keep inline error for dialog context
      const message = err instanceof Error ? err.message : String(err)
      setSubmitError(message)
    } finally {
      setPending(false)
    }
  }, [name, host, port, username, notes, environmentId, projectId, tagIds, assetTags, authMethod, password, keyId, keepAlive, termType, folderId, onSave, onOpenChange])

  const isEditing = !!session

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100vh-2rem)] overflow-y-auto sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>{isEditing ? t('编辑会话') : t('新建会话')}</DialogTitle>
        </DialogHeader>

        <form
          onSubmit={(e) => { e.preventDefault(); handleSubmit() }}
          className="flex flex-col gap-3"
        >
          {submitError && <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{submitError}</div>}
          <FormSection title={t('连接与认证')}>
            <label className="flex flex-col gap-1.5">
              <span className="text-xs font-medium text-muted-foreground">{t('名称')}</span>
              <Input value={name} onChange={(e) => setName(e.target.value)} required autoFocus />
            </label>
            <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('主机')}</span>
                <Input value={host} onChange={(e) => setHost(e.target.value)} required placeholder="192.168.1.1" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('端口')}</span>
                <Input type="number" value={port} onChange={(e) => setPort(e.target.value)} required min={1} max={65535} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('用户名')}</span>
                <Input value={username} onChange={(e) => setUsername(e.target.value)} required placeholder="root" />
              </label>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('认证方式')}</span>
                <LabeledSelect value={authMethod} options={AUTH_OPTIONS} onValueChange={setAuthMethod} />
              </label>
            </div>
            {(authMethod === 'password' || authMethod === 'keyboard-interactive') && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('密码')}</span>
                <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder={t('输入SSH密码')} />
              </label>
            )}
            {authMethod === 'key' && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('SSH 密钥')}</span>
                {keys.length === 0 ? (
                  <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">
                    {t('暂无可用密钥，请先在总览 → 密钥配置中导入')}
                  </div>
                ) : (
                  <LabeledSelect value={keyId} options={keyOptions} onValueChange={setKeyId} placeholder={t('选择密钥...')} />
                )}
              </label>
            )}
          </FormSection>

          <FormSection title={t('资产归属')}>
            {folders && folders.length > 0 && (
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('分组')}</span>
                <LabeledSelect value={folderId} options={folderOptions} onValueChange={setFolderId} placeholder={t('无分组')} />
              </label>
            )}
            <SessionAssetFields environments={environments} projects={projects} tags={assetTags} environmentId={environmentId} projectId={projectId} tagIds={tagIds} notes={notes} onEnvironmentChange={setEnvironmentId} onProjectChange={setProjectId} onTagIdsChange={setTagIds} onNotesChange={setNotes} onCreateEnvironment={onCreateEnvironment} onCreateProject={onCreateProject} onCreateTag={onCreateTag} />
          </FormSection>

          <FormSection title={t('终端选项')}>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-1">
                  <label htmlFor="session-keep-alive" className="text-xs font-medium text-muted-foreground">{t('保活间隔 (秒，0 使用全局默认)')}</label>
                  <Tooltip>
                    <TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t('会话保活说明')} />}>
                      <CircleHelp />
                    </TooltipTrigger>
                    <TooltipContent>{t('会话保活仅维持底层 SSH 连接，不能控制服务端 Shell 的空闲自动登出策略。')}</TooltipContent>
                  </Tooltip>
                </div>
                <Input id="session-keep-alive" type="number" value={keepAlive} onChange={(e) => setKeepAlive(e.target.value)} min={0} />
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-xs font-medium text-muted-foreground">{t('终端类型')}</span>
                <LabeledSelect value={termType} options={termOptions} onValueChange={setTermType} />
              </label>
            </div>
          </FormSection>

          <DialogFooter showCloseButton>
            <Button type="submit" disabled={pending}>{pending ? t('保存中...') : isEditing ? t('保存') : t('创建会话')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

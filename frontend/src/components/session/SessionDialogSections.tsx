import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { SessionAssetFields } from '@/components/session/SessionAssetFields'
import type { SessionDialogProps, useSessionDialogController } from '@/components/session/useSessionDialogController'
import { t } from '@/i18n'

type Controller = ReturnType<typeof useSessionDialogController>

const AUTH_OPTIONS = [
  { value: 'password', label: '密码' },
  { value: 'keyboard-interactive', label: '交互式认证' },
  { value: 'key', label: '密钥' },
  { value: 'agent', label: 'SSH Agent' },
]
const TERM_TYPES = ['xterm-256color', 'xterm', 'vt100', 'vt220', 'linux', 'ansi']

export function SessionConnectionSection({ props, controller }: { props: SessionDialogProps; controller: Controller }) {
  return <>
    <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('名称')}</span><Input value={controller.name} onChange={(event) => controller.setName(event.target.value)} required autoFocus /></label>
    <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('主机')}</span><Input value={controller.host} onChange={(event) => controller.setHost(event.target.value)} required placeholder="192.168.1.1" /></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('端口')}</span><Input type="number" value={controller.port} onChange={(event) => controller.setPort(event.target.value)} required min={1} max={65535} /></label>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('用户名')}</span><Input value={controller.username} onChange={(event) => controller.setUsername(event.target.value)} required placeholder="root" /></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('认证方式')}</span><LabeledSelect value={controller.authMethod} options={AUTH_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} onValueChange={controller.setAuthMethod} /></label>
    </div>
    <SessionAuthenticationField props={props} controller={controller} />
  </>
}

function SessionAuthenticationField({ props, controller }: { props: SessionDialogProps; controller: Controller }) {
  if (controller.authMethod === 'password' || controller.authMethod === 'keyboard-interactive') {
    return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('密码')}</span><Input type="password" value={controller.password} onChange={(event) => controller.setPassword(event.target.value)} placeholder={props.session ? t('留空则保留原密码') : t('输入SSH密码')} /></label>
  }
  if (controller.authMethod !== 'key') return null
  return <label className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-muted-foreground">{t('SSH 密钥')}</span>
    {controller.keysError ? <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" role="alert">{t('加载密钥列表失败: ${}', controller.keysError)}</div>
      : controller.keys.length === 0 ? <div className="rounded-lg border border-dashed px-3 py-2 text-xs text-muted-foreground">{t('暂无可用密钥，请先在总览 → 密钥配置中导入')}</div>
        : <LabeledSelect value={controller.keyId} options={controller.keyOptions} onValueChange={controller.setKeyId} placeholder={t('选择密钥...')} />}
  </label>
}

export function SessionAssetSection({ props, controller }: { props: SessionDialogProps; controller: Controller }) {
  const folderOptions = (props.folders ?? []).map((folder) => ({ value: folder.id, label: `${folder.name}${folder.isDefault ? t('（默认）') : ''}` }))
  return <>
    {props.folders && props.folders.length > 0 && <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('分组')}</span><LabeledSelect value={controller.folderId} options={folderOptions} onValueChange={controller.setFolderId} placeholder={t('无分组')} /></label>}
    <SessionAssetFields environments={props.environments} projects={props.projects} tags={props.assetTags} environmentId={controller.environmentId} projectId={controller.projectId} tagIds={controller.tagIds} notes={controller.notes} onEnvironmentChange={controller.setEnvironmentId} onProjectChange={controller.setProjectId} onTagIdsChange={controller.setTagIds} onNotesChange={controller.setNotes} onCreateEnvironment={props.onCreateEnvironment} onCreateProject={props.onCreateProject} onCreateTag={props.onCreateTag} />
  </>
}

export function SessionTerminalSection({ controller }: { controller: Controller }) {
  const termOptions = TERM_TYPES.map((termType) => ({ value: termType, label: termType }))
  return <div className="grid grid-cols-2 gap-3">
    <div className="flex flex-col gap-1.5"><div className="flex items-center gap-1">
      <label htmlFor="session-keep-alive" className="text-xs font-medium text-muted-foreground">{t('保活间隔 (秒，0 使用全局默认)')}</label>
      <Tooltip><TooltipTrigger render={<Button type="button" variant="ghost" size="icon-xs" aria-label={t('会话保活说明')} />}><CircleHelp /></TooltipTrigger><TooltipContent>{t('会话保活仅维持底层 SSH 连接，不能控制服务端 Shell 的空闲自动登出策略。')}</TooltipContent></Tooltip>
    </div><Input id="session-keep-alive" type="number" value={controller.keepAlive} onChange={(event) => controller.setKeepAlive(event.target.value)} min={0} /></div>
    <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('终端类型')}</span><LabeledSelect value={controller.termType} options={termOptions} onValueChange={controller.setTermType} /></label>
  </div>
}

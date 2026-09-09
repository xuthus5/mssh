import { CheckCircle2, Loader2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { Switch } from '@/components/ui/switch'
import { t } from '@/i18n'
import type { Session } from '@/lib/sessionModels'
import type { useSessionDialogController } from '@/components/session/useSessionDialogController'

type Controller = ReturnType<typeof useSessionDialogController>
const AUTH_OPTIONS = [
  { value: 'password', label: '密码' }, { value: 'keyboard-interactive', label: '交互式认证' },
  { value: 'key', label: '密钥' }, { value: 'agent', label: 'SSH Agent' },
]

export function SSHJumpHostSection({ controller }: { controller: Controller }) {
  const jump = controller.jumpHost
  return <>
    <div className="flex items-start justify-between gap-3">
      <div className="flex flex-col gap-1">
        <label htmlFor="session-jump-host-enabled" className="text-xs font-medium text-foreground">{t('启用 SSH 连接隧道')}</label>
        <p className="text-xs leading-relaxed text-muted-foreground">{t('先登录跳板机，再访问内网中的目标主机。')}</p>
      </div>
      <Switch id="session-jump-host-enabled" checked={jump.draft.enabled} disabled={controller.pending} onCheckedChange={(enabled) => jump.change({ enabled })} />
    </div>
    {jump.draft.enabled && <>
      <SSHJumpHostFields controller={controller} />
      <SSHJumpHostAuthentication controller={controller} />
      <div className="flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <Button type="button" variant="outline" size="sm" aria-describedby="session-jump-test-hint" disabled={controller.pending || jump.testing} onClick={() => { void jump.testConnection() }}>
          {jump.testing && <Loader2 className="size-3.5 motion-safe:animate-spin" aria-hidden="true" />}
          {jump.testing ? t('测试中...') : t('测试隧道连接')}
        </Button>
        <p id="session-jump-test-hint" className="min-w-0 flex-1 text-xs leading-relaxed text-muted-foreground">{t('测试仅验证跳板机登录，目标主机在连接时验证。')}</p>
        {jump.testState.status === 'success' && <p role="status" className="flex w-full items-center gap-1.5 text-xs text-foreground"><CheckCircle2 className="size-3.5" aria-hidden="true" />{jump.testState.message}</p>}
        {jump.testState.status === 'error' && <p role="alert" className="w-full rounded-lg border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">{jump.testState.message}</p>}
      </div>
    </>}
  </>
}

function SSHJumpHostFields({ controller }: { controller: Controller }) {
  const { draft, change } = controller.jumpHost
  return <>
    <div className="grid grid-cols-[minmax(0,1fr)_6rem] gap-3">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('隧道主机')}</span><Input value={draft.host} onChange={(event) => change({ host: event.target.value })} required placeholder="bastion.example.com" /></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('隧道端口')}</span><Input type="number" value={draft.port} onChange={(event) => change({ port: event.target.value })} required min={1} max={65535} /></label>
    </div>
    <div className="grid grid-cols-2 gap-3">
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('隧道用户名')}</span><Input value={draft.username} onChange={(event) => change({ username: event.target.value })} required placeholder="deploy" /></label>
      <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('隧道认证方式')}</span><LabeledSelect value={draft.authMethod} options={AUTH_OPTIONS.map((option) => ({ ...option, label: t(option.label) }))} disabled={controller.pending} onValueChange={(authMethod) => change({ authMethod: authMethod as Session['authMethod'] })} /></label>
    </div>
  </>
}

function SSHJumpHostAuthentication({ controller }: { controller: Controller }) {
  const { draft, change, keepPassword } = controller.jumpHost
  if (draft.authMethod === 'password' || draft.authMethod === 'keyboard-interactive') {
    return <label className="flex flex-col gap-1.5"><span className="text-xs font-medium text-muted-foreground">{t('隧道密码')}</span><Input type="password" value={draft.password} onChange={(event) => change({ password: event.target.value })} autoComplete="new-password" placeholder={keepPassword ? t('留空则保留原密码') : t('输入跳板机密码')} /></label>
  }
  if (draft.authMethod !== 'key') return null
  return <label className="flex flex-col gap-1.5">
    <span className="text-xs font-medium text-muted-foreground">{t('隧道 SSH 密钥')}</span>
    {controller.keysError ? <div role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive">{t('加载密钥列表失败: ${}', controller.keysError)}</div>
      : controller.keys.length === 0 ? <div className="rounded-lg border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{t('暂无可用密钥，请先在总览 → 密钥配置中导入')}</div>
        : <LabeledSelect value={draft.keyId} options={controller.keyOptions} disabled={controller.pending} onValueChange={(keyId) => change({ keyId })} placeholder={t('选择密钥...')} />}
  </label>
}

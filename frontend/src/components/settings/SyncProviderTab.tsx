import { useState, type ReactNode } from 'react'
import { Cloud, Database, Eye, EyeOff, GitFork, PlugZap } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import { SyncProvider, type SyncConfig, type SyncConfigInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


interface Props {
  input: SyncConfigInput
  saved?: SyncConfig
  pending: string | null
  error: string | null
  onChange: (input: SyncConfigInput) => void
  onTest: () => Promise<void>
}

const providers = [
  { value: SyncProvider.SyncProviderGist, label: 'GitHub Gist', detail: 'Secret Gist', icon: GitFork },
  { value: SyncProvider.SyncProviderWebDAV, label: 'WebDAV', detail: t('HTTPS 目录'), icon: Cloud },
  { value: SyncProvider.SyncProviderS3, label: 'S3', detail: 'AWS / MinIO / Ceph', icon: Database },
]

export function SyncProviderTab(props: Props) {
  const [showSecrets, setShowSecrets] = useState(false)
  const update = (patch: Partial<SyncConfigInput>) => props.onChange({ ...props.input, ...patch })
  return <div className="flex flex-col gap-5">
    <Alert><AlertDescription>{t('云同步使用“设置 → 安全”中的应用密码加密备份。请先配置应用密码，并在各设备保持一致。')}</AlertDescription></Alert>
    <ProviderSelector input={props.input} onChange={(provider) => update({ provider })} />
    <div className="border-t border-border pt-5">
      {props.input.provider === SyncProvider.SyncProviderGist && <GistFields {...props} showSecrets={showSecrets} />}
      {props.input.provider === SyncProvider.SyncProviderWebDAV && <WebDAVFields {...props} showSecrets={showSecrets} />}
      {props.input.provider === SyncProvider.SyncProviderS3 && <S3Fields {...props} showSecrets={showSecrets} />}
    </div>
    {props.error && <Alert variant="destructive"><AlertDescription>{props.error}</AlertDescription></Alert>}
    <div className="flex flex-wrap justify-end gap-2 border-t border-border pt-4">
      <Button type="button" variant="outline" disabled={props.pending !== null} onClick={() => void props.onTest().catch(() => undefined)}><PlugZap data-icon="inline-start" />{t('测试连接')}</Button>
    </div>
  </div>
}

function ProviderSelector({ input, onChange }: { input: SyncConfigInput; onChange: (provider: SyncProvider) => void }) {
  return <div><SectionTitle title={t('云同步提供商')} detail={t('远端固定保存为 .msshbackup，同时只启用一个提供商。')} />
    <div className="grid gap-2 md:grid-cols-3">{providers.map((provider) => {
      const Icon = provider.icon
      const active = input.provider === provider.value
      return <button key={provider.value} type="button" aria-pressed={active} onClick={() => onChange(provider.value)} className={cn('flex min-h-16 items-center gap-3 rounded-lg border px-3 text-left transition-colors', active ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted/50')}>
        <Icon className="size-5 shrink-0" /><span className="min-w-0"><span className="block text-sm font-medium">{provider.label}</span><span className="block truncate text-xs text-muted-foreground">{provider.detail}</span></span>
      </button>
    })}</div>
  </div>
}

function GistFields(props: Props & { showSecrets: boolean }) {
  const gist = props.input.gist
  const change = (patch: Partial<SyncConfigInput['gist']>) => props.onChange({ ...props.input, gist: { ...gist, ...patch } })
  return <div className="grid gap-3 md:grid-cols-2"><Field label={t('Gist ID 或 URL')}><Input aria-label={t('Gist ID 或 URL')} value={gist.gist_id} placeholder={t('首次推送可留空自动创建')} onChange={(event) => change({ gist_id: event.target.value })} /></Field><SecretField label="GitHub Token" value={gist.token} saved={props.saved?.gist.token_saved} clear={gist.clear_token} show={props.showSecrets} onValue={(token) => change({ token })} onClear={(clear_token) => change({ clear_token })} /></div>
}

function WebDAVFields(props: Props & { showSecrets: boolean }) {
  const webdav = props.input.webdav
  const change = (patch: Partial<SyncConfigInput['webdav']>) => props.onChange({ ...props.input, webdav: { ...webdav, ...patch } })
  return <div className="grid gap-3 md:grid-cols-2"><Field label="WebDAV URL" className="md:col-span-2"><Input aria-label="WebDAV URL" value={webdav.url} placeholder="https://dav.example.com/backups" onChange={(event) => change({ url: event.target.value })} /></Field><Field label={t('用户名')}><Input aria-label={t('WebDAV 用户名')} value={webdav.username} onChange={(event) => change({ username: event.target.value })} /></Field><SecretField label={t('密码')} value={webdav.password} saved={props.saved?.webdav.password_saved} clear={webdav.clear_password} show={props.showSecrets} onValue={(password) => change({ password })} onClear={(clear_password) => change({ clear_password })} /></div>
}

function S3Fields(props: Props & { showSecrets: boolean }) {
  const s3 = props.input.s3
  const change = (patch: Partial<SyncConfigInput['s3']>) => props.onChange({ ...props.input, s3: { ...s3, ...patch } })
  return <div className="grid gap-3 md:grid-cols-2"><Field label="Endpoint"><Input aria-label="S3 Endpoint" value={s3.endpoint} placeholder={t('AWS S3 可留空')} onChange={(event) => change({ endpoint: event.target.value })} /></Field><Field label="Region"><Input aria-label="S3 Region" value={s3.region} onChange={(event) => change({ region: event.target.value })} /></Field><Field label="Bucket"><Input aria-label="S3 Bucket" value={s3.bucket} onChange={(event) => change({ bucket: event.target.value })} /></Field><Field label="Prefix"><Input aria-label="S3 Prefix" value={s3.prefix} placeholder={t('可选目录前缀')} onChange={(event) => change({ prefix: event.target.value })} /></Field><Field label="Access Key ID"><Input aria-label="S3 Access Key ID" value={s3.access_key_id} onChange={(event) => change({ access_key_id: event.target.value })} /></Field><SecretField label="Secret Access Key" value={s3.secret_key} saved={props.saved?.s3.secret_key_saved} clear={s3.clear_secret_key} show={props.showSecrets} onValue={(secret_key) => change({ secret_key })} onClear={(clear_secret_key) => change({ clear_secret_key })} /><div className="flex items-center justify-between rounded-lg border border-border px-3 py-2 md:col-span-2"><div><div className="text-sm font-medium">{t('Path-style 访问')}</div><div className="text-xs text-muted-foreground">{t('MinIO、Ceph 等兼容服务通常需要开启。')}</div></div><Switch aria-label={t('S3 Path-style 访问')} checked={s3.path_style} onCheckedChange={(path_style) => change({ path_style })} /></div></div>
}

function SecretField(props: { label: string; value: string; saved?: boolean; clear: boolean; show: boolean; onValue: (value: string) => void; onClear: (value: boolean) => void }) {
  return <Field label={props.label}><Input aria-label={props.label} type={props.show ? 'text' : 'password'} value={props.value} placeholder={props.saved ? t('已安全保存，留空保持不变') : ''} onChange={(event) => props.onValue(event.target.value)} />{props.saved && <label className="mt-1.5 flex items-center gap-2 text-xs text-muted-foreground"><Checkbox checked={props.clear} onCheckedChange={(checked) => props.onClear(checked === true)} />{t('清除已保存凭据')}</label>}</Field>
}

function Field({ label, className, children }: { label: string; className?: string; children: ReactNode }) {
  return <label className={cn('flex flex-col gap-1.5', className)}><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>
}

function SectionTitle({ title, detail }: { title: string; detail: string }) {
  return <div className="mb-3"><div className="text-sm font-medium">{title}</div><div className="text-xs text-muted-foreground">{detail}</div></div>
}

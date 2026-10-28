import { useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { CheckCircle2, Copy, ExternalLink, GitFork, LoaderCircle, X } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { toast } from '@/components/ui/toast'
import type { GistOAuthResult, GistOAuthStart, GistSyncConfig } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { useGistOAuth } from '@/hooks/useGistOAuth'
import { getClipboard } from '@/lib/clipboard'
import { t } from '@/i18n'

interface Props {
  saved?: GistSyncConfig
  pending: string | null
  onStart: () => Promise<GistOAuthStart>
  onPoll: (flowID: string) => Promise<GistOAuthResult>
  onCancel: (flowID: string) => Promise<void>
  onConnected: (result: GistOAuthResult) => void | Promise<void>
}

export function GistOAuthConnect(props: Props) {
  const oauth = useGistOAuth({
    start: props.onStart, poll: props.onPoll, cancel: props.onCancel, onConnected: props.onConnected,
  })
  const busy = props.pending !== null || oauth.phase === 'starting' || oauth.phase === 'waiting'
  return <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
    <div className="flex flex-wrap items-start gap-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/40"><GitFork className="size-4" /></div>
      <div className="min-w-48 flex-1">
        <div className="text-sm font-medium">{t('GitHub 账户')}</div>
        <p className="mt-1 text-xs text-muted-foreground">{connectionDescription(props.saved, oauth.phase)}</p>
        {props.saved?.gist_id ? <p className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{t('备份 Gist')}: {props.saved.gist_id}</p> : null}
      </div>
      <Button type="button" size="sm" disabled={busy} onClick={() => { void oauth.start() }}>
        {oauth.phase === 'starting' ? <LoaderCircle data-icon="inline-start" className="animate-spin" /> : <GitFork data-icon="inline-start" />}
        {props.saved?.token_saved ? t('重新授权') : t('使用 GitHub 授权')}
      </Button>
    </div>
    {oauth.phase === 'waiting' && oauth.flow ? <DeviceFlowPrompt flow={oauth.flow} notice={oauth.notice} onCancel={oauth.cancel} /> : null}
    {oauth.phase === 'success' ? <OAuthSuccess result={oauth.result} notice={oauth.notice} /> : null}
    {oauth.phase === 'error' ? <Alert variant="destructive" className="mt-3"><AlertDescription>{oauth.error}</AlertDescription></Alert> : null}
  </div>
}

function connectionDescription(saved: GistSyncConfig | undefined, phase: string): string {
  if (phase === 'starting') return t('正在向 GitHub 申请设备授权…')
  if (phase === 'waiting') return t('等待 GitHub 授权完成…')
  if (saved?.token_saved) return t('GitHub 凭据已加密保存；可随时重新授权或清除。')
  return t('授权后自动保存凭据并查找现有备份 Gist，无需填写 Token。')
}

function DeviceFlowPrompt({ flow, notice, onCancel }: { flow: GistOAuthStart; notice: string; onCancel: () => Promise<void> }) {
  const [actionError, setActionError] = useState('')
  const copyCode = async () => {
    setActionError('')
    try {
      await getClipboard().writeText(flow.user_code)
      toast(t('授权码已复制'), 'success')
    } catch (error) {
      setActionError(t('复制授权码失败: ${}', error instanceof Error ? error.message : String(error)))
    }
  }
  const openVerification = async () => {
    setActionError('')
    try { await Browser.OpenURL(flow.verification_uri) }
    catch (error) { setActionError(t('打开 GitHub 授权页面失败: ${}', error instanceof Error ? error.message : String(error))) }
  }
  return <div className="mt-4 rounded-lg border border-primary/25 bg-primary/5 p-3">
    <p className="text-xs text-muted-foreground">{t('在 GitHub 页面输入以下授权码：')}</p>
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <code className="rounded-md border border-border bg-background px-3 py-1.5 text-lg font-semibold tracking-[0.16em]">{flow.user_code}</code>
      <Button type="button" size="sm" variant="outline" onClick={() => { void copyCode() }}><Copy data-icon="inline-start" />{t('复制')}</Button>
      <Button type="button" size="sm" variant="outline" onClick={() => { void openVerification() }}><ExternalLink data-icon="inline-start" />{t('打开 GitHub')}</Button>
      <Button type="button" size="sm" variant="ghost" onClick={() => { void onCancel() }}><X data-icon="inline-start" />{t('取消')}</Button>
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{notice || t('等待 GitHub 授权完成…')}</p>
    {actionError ? <p role="alert" className="mt-1 text-xs text-destructive">{actionError}</p> : null}
  </div>
}

function OAuthSuccess({ result, notice }: { result: GistOAuthResult | null; notice: string }) {
  if (result?.status !== 'success') return null
  return <Alert className="mt-3 border-emerald-500/30 bg-emerald-500/5"><AlertDescription className="flex items-start gap-2 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="mt-0.5 size-4 shrink-0" />{notice || t('GitHub 授权成功')}{result.account ? ` · @${result.account}` : ''}</AlertDescription></Alert>
}

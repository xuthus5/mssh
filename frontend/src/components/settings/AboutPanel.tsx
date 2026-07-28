import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { Browser } from '@wailsio/runtime'
import { Code2, ExternalLink, RefreshCw } from 'lucide-react'
import { AboutService } from '@/lib/wails'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'


interface AboutState {
  currentVersion: string | null
  repositoryURL: string
}

type PanelMessage = {
  text: string
  variant: 'default' | 'destructive'
} | null

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}

function useAboutInfo(lifecycle: MutableRefObject<number>) {
  const [about, setAbout] = useState<AboutState>({ currentVersion: '', repositoryURL: 'https://github.com/xuthus5/mssh' })
  const [message, setMessage] = useState<PanelMessage>(null)
  const infoRequest = useRef(0)
  const loadInfo = useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const request = ++infoRequest.current
    const isCurrent = () => lifecycle.current === lifecycleToken && infoRequest.current === request
    try {
      const info = await AboutService.Info()
      if (!isCurrent()) return
      setAbout({ currentVersion: info.current_version, repositoryURL: info.repository_url })
      setMessage(null)
    } catch (error: unknown) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('load about info failed', error)
      setAbout((current) => ({ ...current, currentVersion: null }))
      setMessage({ text: t('加载关于信息失败: ${}', message), variant: 'destructive' })
    }
  }, [])
  useEffect(() => { void loadInfo() }, [loadInfo])
  return { about, message, setMessage }
}

function useUpdateCheck(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>) {
  const [latestVersion, setLatestVersion] = useState('')
  const [releaseURL, setReleaseURL] = useState('')
  const [checking, setChecking] = useState(false)
  const updateRequest = useRef(0)
  const checkingRef = useRef(false)
  useEffect(() => () => { checkingRef.current = false }, [])
  const checkUpdate = useCallback(async () => {
    if (checkingRef.current) return
    const lifecycleToken = lifecycle.current
    const request = ++updateRequest.current
    const isCurrent = () => lifecycle.current === lifecycleToken && updateRequest.current === request
    checkingRef.current = true
    setChecking(true)
    setMessage(null)
    try {
      const update = await AboutService.CheckUpdate()
      if (!update) throw new Error(t('未获取到版本信息'))
      if (!isCurrent()) return
      setLatestVersion(update.latest_version)
      setReleaseURL(update.release_url)
      setMessage({
        text: update.update_available ? t('发现新版本，可前往发布页下载。') : t('当前已是最新版本。'),
        variant: 'default',
      })
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      setMessage({ text: t('检查更新失败：${}', message), variant: 'destructive' })
    } finally {
      if (updateRequest.current === request) checkingRef.current = false
      if (isCurrent()) setChecking(false)
    }
  }, [])
  return { latestVersion, releaseURL, checking, checkUpdate }
}

function useOpenURL(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>) {
  return useCallback((url: string) => {
    const lifecycleToken = lifecycle.current
    void Browser.OpenURL(url).catch((error: unknown) => {
      if (lifecycle.current !== lifecycleToken) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('open URL failed', error)
      setMessage({ text: t('打开链接失败: ${}', message), variant: 'destructive' })
    })
  }, [])
}

export function AboutPanel() {
  const lifecycle = useLifecycleRef()
  const { about, message, setMessage } = useAboutInfo(lifecycle)
  const { latestVersion, releaseURL, checking, checkUpdate } = useUpdateCheck(lifecycle, setMessage)
  const openURL = useOpenURL(lifecycle, setMessage)
  return <div className="flex flex-col gap-4 pt-2">
    <Card className="rounded-xl border shadow-sm">
      <CardHeader><CardTitle className="text-base">MSSH</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{t('当前版本')}</span><span className="font-mono">{about.currentVersion === null ? t('未知') : about.currentVersion || t('加载中…')}</span></div>
        <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{t('社区最新版本')}</span><span className="font-mono">{latestVersion || t('尚未检查')}</span></div>
      </CardContent>
    </Card>
    {message && <Alert variant={message.variant}><AlertDescription>{message.text}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => { void checkUpdate() }} disabled={checking}><RefreshCw className={checking ? 'animate-spin' : ''} />{checking ? t('检查中…') : t('检查更新')}</Button>
      {releaseURL && <Button variant="outline" onClick={() => openURL(releaseURL)}><ExternalLink />{t('查看发布页')}</Button>}
      <Button variant="outline" onClick={() => openURL(about.repositoryURL)}><Code2 />{t('GitHub 社区')}</Button>
    </div>
    <p className="break-all text-xs text-muted-foreground">{about.repositoryURL}</p>
  </div>
}

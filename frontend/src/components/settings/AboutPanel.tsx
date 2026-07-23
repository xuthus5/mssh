import { useEffect, useState } from 'react'
import { Browser } from '@wailsio/runtime'
import { Code2, ExternalLink, RefreshCw } from 'lucide-react'
import { AboutService } from '@/lib/wails'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { logger } from '@/lib/logger'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'


interface AboutState {
  currentVersion: string
  repositoryURL: string
}

export function AboutPanel() {
  const [about, setAbout] = useState<AboutState>({ currentVersion: t('加载中…'), repositoryURL: 'https://github.com/xuthus5/mssh' })
  const [latestVersion, setLatestVersion] = useState(t('尚未检查'))
  const [releaseURL, setReleaseURL] = useState('')
  const [checking, setChecking] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    AboutService.Info().then((info) => setAbout({ currentVersion: info.current_version, repositoryURL: info.repository_url })).catch((error: unknown) => {
      const message = error instanceof Error ? error.message : String(error)
      logger.error('load about info failed', error)
      setAbout((current) => ({ ...current, currentVersion: t('未知') }))
      toast(t('加载关于信息失败: ${}', message), 'error')
    })
  }, [])

  const checkUpdate = async () => {
    setChecking(true)
    setMessage('')
    try {
      const update = await AboutService.CheckUpdate()
      if (!update) throw new Error(t('未获取到版本信息'))
      setLatestVersion(update.latest_version)
      setReleaseURL(update.release_url)
      setMessage(update.update_available ? t('发现新版本，可前往发布页下载。') : t('当前已是最新版本。'))
    } catch (error) {
      setMessage(t('检查更新失败：${}', error instanceof Error ? error.message : String(error)))
    } finally {
      setChecking(false)
    }
  }

  const openURL = (url: string) => {
    void Browser.OpenURL(url).catch((error: unknown) => logger.error('open URL failed', error))
  }

  return <div className="flex flex-col gap-4 pt-2">
    <Card className="rounded-xl border shadow-sm">
      <CardHeader><CardTitle className="text-base">MSSH</CardTitle></CardHeader>
      <CardContent className="grid gap-3 text-sm">
        <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{t('当前版本')}</span><span className="font-mono">{about.currentVersion}</span></div>
        <div className="flex items-center justify-between gap-4"><span className="text-muted-foreground">{t('社区最新版本')}</span><span className="font-mono">{latestVersion}</span></div>
      </CardContent>
    </Card>
    {message && <Alert><AlertDescription>{message}</AlertDescription></Alert>}
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => { void checkUpdate() }} disabled={checking}><RefreshCw className={checking ? 'animate-spin' : ''} />{checking ? t('检查中…') : t('检查更新')}</Button>
      {releaseURL && <Button variant="outline" onClick={() => openURL(releaseURL)}><ExternalLink />{t('查看发布页')}</Button>}
      <Button variant="outline" onClick={() => openURL(about.repositoryURL)}><Code2 />{t('GitHub 社区')}</Button>
    </div>
    <p className="break-all text-xs text-muted-foreground">{about.repositoryURL}</p>
  </div>
}

import { useCallback, useEffect, useRef, useState, type Dispatch, type MutableRefObject, type SetStateAction } from 'react'
import { Browser } from '@wailsio/runtime'
import { Code2, Download, ExternalLink, RefreshCw, RotateCcw } from 'lucide-react'
import { AboutService, SettingService } from '@/lib/wails'
import { Button } from '@/components/ui/button'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Switch } from '@/components/ui/switch'
import { SettingsCard, SettingsRow, SettingsSectionHeader } from '@/components/settings/settings-ui'
import { requestConfirm } from '@/lib/confirmDialog'
import { logger } from '@/lib/logger'
import { t } from '@/i18n'

const AUTO_UPDATE_SETTING_KEY = 'application.auto_update'

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

function useAutoUpdateSetting(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>) {
  const [enabled, setEnabled] = useState(false)
  const [saving, setSaving] = useState(false)
  const request = useRef(0)
  useEffect(() => {
    const lifecycleToken = lifecycle.current
    const currentRequest = ++request.current
    void SettingService.GetMany([AUTO_UPDATE_SETTING_KEY]).then((settings) => {
      if (lifecycle.current !== lifecycleToken || request.current !== currentRequest) return
      setEnabled(settings[AUTO_UPDATE_SETTING_KEY]?.value === 'true')
    }).catch((error: unknown) => {
      if (lifecycle.current !== lifecycleToken || request.current !== currentRequest) return
      logger.error('load automatic update setting failed', error)
      const message = error instanceof Error ? error.message : String(error)
      setMessage({ text: t('加载自动更新设置失败: ${}', message), variant: 'destructive' })
    })
  }, [])
  const update = useCallback(async (next: boolean) => {
    if (saving) return
    const lifecycleToken = lifecycle.current
    const currentRequest = ++request.current
    setSaving(true)
    setMessage(null)
    try {
      await SettingService.Set({
        key: AUTO_UPDATE_SETTING_KEY,
        namespace: 'application',
        value: JSON.stringify(next),
        value_type: 'boolean',
        version: 1,
      })
      if (lifecycle.current !== lifecycleToken || request.current !== currentRequest) return
      setEnabled(next)
      if (next) void AboutService.RequestAutoUpdateCheck().catch((error: unknown) => logger.error('request automatic update check failed', error))
      setMessage({ text: next ? t('已开启自动更新：每小时在后台检查并下载新版本。') : t('已关闭自动更新。'), variant: 'default' })
    } catch (error: unknown) {
      if (lifecycle.current !== lifecycleToken || request.current !== currentRequest) return
      const message = error instanceof Error ? error.message : String(error)
      logger.error('save automatic update setting failed', error)
      setMessage({ text: t('保存自动更新设置失败: ${}', message), variant: 'destructive' })
    } finally {
      if (lifecycle.current === lifecycleToken && request.current === currentRequest) setSaving(false)
    }
  }, [saving])
  return { enabled, saving, update }
}

interface UpdatePayload {
  latest_version: string
  release_url: string
  update_available: boolean
}

function useReadyUpdate(lifecycle: MutableRefObject<number>, onReady: (update: UpdatePayload) => void) {
  useEffect(() => {
    const lifecycleToken = lifecycle.current
    let mounted = true
    void AboutService.ReadyUpdate().then((update) => {
      if (!mounted || lifecycle.current !== lifecycleToken || !update?.update_available) return
      onReady(update)
    }).catch((error: unknown) => logger.error('load ready update failed', error))
    return () => { mounted = false }
  }, [])
}

function useCheckUpdate(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>, onChecked: (update: UpdatePayload) => void) {
  const [checking, setChecking] = useState(false)
  const request = useRef(0)
  const active = useRef(false)
  const checkUpdate = useCallback(async () => {
    if (active.current) return
    const lifecycleToken = lifecycle.current
    const currentRequest = ++request.current
    const isCurrent = () => lifecycle.current === lifecycleToken && request.current === currentRequest
    active.current = true
    setChecking(true)
    setMessage(null)
    try {
      const update = await AboutService.CheckUpdate()
      if (!update) throw new Error(t('未获取到版本信息'))
      if (!isCurrent()) return
      onChecked(update)
      setMessage({
        text: update.update_available ? t('发现新版本 ${}，可在此下载更新。', update.latest_version) : t('当前已是最新版本。'),
        variant: 'default',
      })
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      setMessage({ text: t('检查更新失败：${}', message), variant: 'destructive' })
    } finally {
      if (request.current === currentRequest) active.current = false
      if (isCurrent()) setChecking(false)
    }
  }, [onChecked])
  return { checking, checkUpdate }
}

function useDownloadUpdate(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>, onDownloaded: (update: UpdatePayload) => void) {
  const [downloading, setDownloading] = useState(false)
  const request = useRef(0)
  const active = useRef(false)

  const downloadUpdate = useCallback(async () => {
    if (active.current) return
    const lifecycleToken = lifecycle.current
    const currentRequest = ++request.current
    const isCurrent = () => lifecycle.current === lifecycleToken && request.current === currentRequest
    active.current = true
    setDownloading(true)
    setMessage(null)
    try {
      const update = await AboutService.DownloadUpdate()
      if (!update) throw new Error(t('未获取到版本信息'))
      if (!isCurrent()) return
      onDownloaded(update)
      setMessage({
        text: update.update_available ? t('更新 ${} 已下载，重启后生效。', update.latest_version) : t('当前已是最新版本。'),
        variant: 'default',
      })
    } catch (error) {
      if (!isCurrent()) return
      const message = error instanceof Error ? error.message : String(error)
      setMessage({ text: t('下载更新失败：${}', message), variant: 'destructive' })
    } finally {
      if (request.current === currentRequest) active.current = false
      if (isCurrent()) setDownloading(false)
    }
  }, [onDownloaded])
  return { downloading, downloadUpdate }
}

function useRestartUpdate(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>) {
  const [restarting, setRestarting] = useState(false)

  const restartUpdate = useCallback(async () => {
    const lifecycleToken = lifecycle.current
    const confirmed = await requestConfirm({
      title: t('重启并安装更新？'),
      description: t('应用将关闭并重新启动，以完成新版本安装。'),
      confirmLabel: t('立即重启'),
    })
    if (!confirmed || lifecycle.current !== lifecycleToken) return
    setRestarting(true)
    try {
      await AboutService.RestartUpdate()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      setMessage({ text: t('重启更新失败：${}', message), variant: 'destructive' })
      setRestarting(false)
    }
  }, [])
  return { restarting, restartUpdate }
}

function useUpdateActions(lifecycle: MutableRefObject<number>, setMessage: Dispatch<SetStateAction<PanelMessage>>) {
  const [latestVersion, setLatestVersion] = useState('')
  const [releaseURL, setReleaseURL] = useState('')
  const [updateAvailable, setUpdateAvailable] = useState(false)
  const [ready, setReady] = useState(false)
  const applyDownloaded = useCallback((update: UpdatePayload) => {
    setLatestVersion(update.latest_version)
    setReleaseURL(update.release_url)
    setUpdateAvailable(update.update_available)
    setReady(update.update_available)
  }, [])
  const applyChecked = useCallback((update: UpdatePayload) => {
    setLatestVersion(update.latest_version)
    setReleaseURL(update.release_url)
    setUpdateAvailable(update.update_available)
  }, [])
  useReadyUpdate(lifecycle, applyDownloaded)
  const check = useCheckUpdate(lifecycle, setMessage, applyChecked)
  const download = useDownloadUpdate(lifecycle, setMessage, applyDownloaded)
  const restart = useRestartUpdate(lifecycle, setMessage)

  return { latestVersion, releaseURL, updateAvailable, ready, ...check, ...download, ...restart }
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
  const autoUpdate = useAutoUpdateSetting(lifecycle, setMessage)
  const updates = useUpdateActions(lifecycle, setMessage)
  const openURL = useOpenURL(lifecycle, setMessage)
  return <div className="flex flex-col">
    <div className="mb-4"><h2 className="text-lg font-semibold">{t('关于')}</h2><p className="mt-1 text-sm text-muted-foreground">{t('版本信息与社区链接。')}</p></div>
    <SettingsSectionHeader title="MSSH" description={t('Secure Shell Client & Session Manager')} />
    <SettingsCard divided>
      <SettingsRow label={t('当前版本')}>
        <span className="font-mono text-sm text-foreground">{about.currentVersion === null ? t('未知') : about.currentVersion || t('加载中…')}</span>
      </SettingsRow>
      <SettingsRow label={t('社区最新版本')}>
        <span className="font-mono text-sm text-foreground">{updates.latestVersion || t('尚未检查')}</span>
      </SettingsRow>
      <SettingsRow label={t('自动检查并下载更新')} description={t('开启后每小时在后台检查，发现新版本会自动下载，完成后提示重启。')}>
        <Switch aria-label={t('自动检查并下载更新')} checked={autoUpdate.enabled} disabled={autoUpdate.saving} onCheckedChange={(value) => { void autoUpdate.update(value) }} />
      </SettingsRow>
    </SettingsCard>
    {message && <div className="mt-4"><Alert variant={message.variant}><AlertDescription>{message.text}</AlertDescription></Alert></div>}
    <div className="mt-4 flex flex-wrap gap-2">
      <Button onClick={() => { void updates.checkUpdate() }} disabled={updates.checking || updates.downloading}><RefreshCw className={updates.checking ? 'animate-spin' : ''} />{updates.checking ? t('检查中…') : t('检查更新')}</Button>
      {updates.updateAvailable && !updates.ready && <Button variant="outline" onClick={() => { void updates.downloadUpdate() }} disabled={updates.downloading}><Download className={updates.downloading ? 'animate-pulse' : ''} />{updates.downloading ? t('下载中…') : t('下载更新')}</Button>}
      {updates.ready && <Button onClick={() => { void updates.restartUpdate() }} disabled={updates.restarting}><RotateCcw className={updates.restarting ? 'animate-spin' : ''} />{updates.restarting ? t('正在重启…') : t('立即重启更新')}</Button>}
      {updates.releaseURL && <Button variant="outline" onClick={() => openURL(updates.releaseURL)}><ExternalLink />{t('查看发布页')}</Button>}
      <Button variant="outline" onClick={() => openURL(about.repositoryURL)}><Code2 />{t('GitHub 社区')}</Button>
    </div>
    <p className="mt-3 break-all text-xs text-muted-foreground">{about.repositoryURL}</p>
  </div>
}

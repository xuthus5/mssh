import { useCallback, useState, type FormEvent } from 'react'
import { Eye, EyeOff } from 'lucide-react'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import type { SyncConfig } from '@/hooks/useSettings'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { useAsyncAction } from '@/hooks/useAsyncAction'

interface Props {
  sync: SyncConfig
  onSave: (c: SyncConfig) => void
  onExport: () => void
  onImport: () => void
  onTestCloud: (config: SyncConfig) => Promise<void>
  onPushCloud: (config: SyncConfig) => Promise<void>
  onPullCloud: (config: SyncConfig) => Promise<void>
}

export function SyncPanel({ sync, onSave, onExport, onImport, onTestCloud, onPushCloud, onPullCloud }: Props) {
  const [enabled, setEnabled] = useState(sync.enabled)
  const [url, setUrl] = useState(sync.url)
  const [username, setUsername] = useState(sync.username)
  const [password, setPassword] = useState(sync.password)
  const [masterKey, setMasterKey] = useState(sync.masterKey ?? '')
  const [masterKeyConfirmation, setMasterKeyConfirmation] = useState(sync.masterKey ?? '')
  const [showMasterKey, setShowMasterKey] = useState(false)
  const masterKeyValid = masterKey.length >= 12 && masterKey === masterKeyConfirmation
  const cloudConfig = { enabled, url, username, password, masterKey }
  const executeCloud = useCallback(async (input: { action: (config: SyncConfig) => Promise<void>; config: SyncConfig }) => input.action(input.config), [])
  const cloud = useAsyncAction(executeCloud)

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault()
    if (!masterKeyValid) return
    onSave({ enabled, url, username, password, masterKey })
  }

  const runCloudAction = async (action: (config: SyncConfig) => Promise<void>) => {
    await cloud.run({ action, config: cloudConfig }).catch(() => undefined)
  }

  return (
    <div className="flex flex-col gap-4 pt-2">
      <div className="flex items-center gap-4">
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" disabled={!sync.masterKey} onClick={onExport}>
            导出配置
          </Button>
          <span className="text-xs text-muted-foreground">
            保存当前设置为文件
          </span>
        </div>
        <div className="flex flex-col gap-1.5">
          <Button size="sm" variant="outline" disabled={!sync.masterKey} onClick={onImport}>
            导入配置
          </Button>
          <span className="text-xs text-muted-foreground">
            从文件加载设置
          </span>
        </div>
      </div>
      <div className="rounded-xl border border-border p-4 shadow-sm">
        <div className="mb-3"><h4 className="text-sm font-medium">备份主密钥</h4><p className="text-xs text-muted-foreground">用于加密和解密 `.msshbackup` 文本备份，不会写入备份文件。</p></div>
        <form onSubmit={handleSubmit} className="flex flex-col gap-3">
          <div className="grid gap-3 md:grid-cols-2">
            <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">主密钥</label><div className="relative"><Input aria-label="备份主密钥" type={showMasterKey ? 'text' : 'password'} value={masterKey} onChange={(event) => setMasterKey(event.target.value)} className="pr-10" /><Button type="button" size="icon-xs" variant="ghost" aria-label={showMasterKey ? '隐藏主密钥' : '显示主密钥'} className="absolute right-1 top-1/2 -translate-y-1/2" onClick={() => setShowMasterKey((value) => !value)}>{showMasterKey ? <EyeOff /> : <Eye />}</Button></div></div>
            <div className="flex flex-col gap-1.5"><label className="text-xs font-medium text-muted-foreground">确认主密钥</label><Input aria-label="确认备份主密钥" type={showMasterKey ? 'text' : 'password'} value={masterKeyConfirmation} onChange={(event) => setMasterKeyConfirmation(event.target.value)} /></div>
          </div>
          <div className="flex items-center justify-between gap-3"><span className="text-xs text-muted-foreground">至少 12 个字符；修改后仅影响后续导出的备份。</span><Button type="submit" size="sm" disabled={!masterKeyValid}>保存主密钥</Button></div>
        </form>
      </div>
      <div className="border-t border-border pt-4">
        <h4 className="text-sm font-medium mb-3">云同步</h4>
        <Alert className="mb-3"><AlertTitle>加密文本同步</AlertTitle><AlertDescription>支持 HTTPS/WebDAV 文本端点，并使用 ETag 防止覆盖远端新版本。</AlertDescription></Alert>
        <form onSubmit={(event) => { event.preventDefault(); if (masterKeyValid) onSave(cloudConfig) }} className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <Checkbox
              checked={enabled}
              onCheckedChange={(checked) =>
                setEnabled(checked === true)
              }
            />
            <label className="text-sm cursor-pointer">启用云同步</label>
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="text-xs font-medium text-muted-foreground">
              同步 URL
            </label>
            <Input
              aria-label="同步 URL"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://sync.example.com/api"
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                用户名
              </label>
              <Input
                aria-label="用户名"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <label className="text-xs font-medium text-muted-foreground">
                密码
              </label>
              <Input
                aria-label="密码"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
          </div>
          {sync.lastSyncedAt && <div className="rounded-xl border border-border bg-muted/30 px-3 py-2 text-xs text-muted-foreground" data-testid="cloud-sync-version">备份格式 v{sync.formatVersion || 2} · 最近{sync.lastDirection === 'download' ? '下载' : '上传'} {new Date(sync.lastSyncedAt).toLocaleString()} · ETag {sync.etag || '未提供'}</div>}
          {cloud.error && <Alert variant="destructive"><AlertDescription>{cloud.error}</AlertDescription></Alert>}
          <div className="flex justify-end">
            <div className="flex flex-wrap justify-end gap-2"><Button type="button" size="sm" variant="outline" disabled={cloud.pending || !url} onClick={() => void runCloudAction(onTestCloud)}>测试连接</Button><Button type="button" size="sm" variant="outline" disabled={cloud.pending || !url || !masterKeyValid} onClick={() => void runCloudAction(onPullCloud)}>从云端下载</Button><Button type="button" size="sm" variant="outline" disabled={cloud.pending || !url || !masterKeyValid} onClick={() => void runCloudAction(onPushCloud)}>上传到云端</Button></div>
            <Button type="submit" size="sm" disabled={cloud.pending || !masterKeyValid}>
              保存同步配置
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}

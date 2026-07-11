import { useState, useEffect, type FormEvent } from 'react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from '@/components/ui/tabs'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { KeyManager } from '@/components/settings/KeyManager'
import { SyncPanel } from '@/components/settings/SyncPanel'
import type { GeneralSettings, TerminalTheme, KeyInfo, SyncConfig } from '@/hooks/useSettings'
import type { Folder, Session } from '@/hooks/useSession'
import { FolderManager } from '@/components/settings/FolderManager'

interface Props {
  open: boolean
  onOpenChange: (open: boolean) => void
  general: GeneralSettings
  theme: TerminalTheme
  keys: KeyInfo[]
  sync: SyncConfig
  onSaveGeneral: (s: GeneralSettings) => Promise<void>
  onSaveTheme: (t: TerminalTheme) => void
  onGenerateKey: (name: string, type: KeyInfo['type'], bits: number) => void
  onImportKey: (name: string, privateKey: string) => void
  onDeleteKey: (id: string) => void
  onExportKey: (id: string) => Promise<string | undefined>
  onSaveSync: (c: SyncConfig) => void
  onExportConfig: () => void
  onImportConfig: () => void
  folders: Folder[]
  sessions: Session[]
  onCreateFolder: (name: string, parentId: string | null) => Promise<Folder | undefined>
  onRenameFolder: (id: string, name: string) => Promise<void>
  onSetDefaultFolder: (id: string) => Promise<void>
  onDeleteFolder: (id: string) => Promise<void>
}

export default function SettingsDialog({
  open,
  onOpenChange,
  general,
  theme,
  keys,
  sync,
  onSaveGeneral,
  onSaveTheme,
  onGenerateKey,
  onImportKey,
  onDeleteKey,
  onExportKey,
  onSaveSync,
  onExportConfig,
  onImportConfig,
  folders, sessions, onCreateFolder, onRenameFolder, onSetDefaultFolder, onDeleteFolder,
}: Props) {
  const [tab, setTab] = useState('general')
  const [maxPoolSize, setMaxPoolSize] = useState(general.maxPoolSize.toString())
  const [defaultKeepAlive, setDefaultKeepAlive] = useState(
    general.defaultKeepAlive.toString(),
  )
  const [defaultTermType, setDefaultTermType] = useState(
    general.defaultTermType,
  )
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setMaxPoolSize(general.maxPoolSize.toString())
    setDefaultKeepAlive(general.defaultKeepAlive.toString())
    setDefaultTermType(general.defaultTermType)
  }, [general])

  const handleSaveGeneral = async (e: FormEvent) => {
    e.preventDefault()
    setSaving(true)
    try {
      await onSaveGeneral({ maxPoolSize: parseInt(maxPoolSize, 10) || 10, defaultKeepAlive: parseInt(defaultKeepAlive, 10) || 60, defaultTermType })
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList>
            <TabsTrigger value="general">通用</TabsTrigger>
            <TabsTrigger value="appearance">外观</TabsTrigger>
            <TabsTrigger value="keys">密钥</TabsTrigger>
            <TabsTrigger value="folders">分组</TabsTrigger>
            <TabsTrigger value="sync">同步</TabsTrigger>
          </TabsList>
          <TabsContent value="general">
            <form onSubmit={handleSaveGeneral} className="flex flex-col gap-3 pt-2">
              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    最大终端池大小
                  </label>
                  <Input
                    type="number"
                    value={maxPoolSize}
                    onChange={(e) => setMaxPoolSize(e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-medium text-muted-foreground">
                    默认保活间隔 (秒)
                  </label>
                  <Input
                    type="number"
                    value={defaultKeepAlive}
                    onChange={(e) => setDefaultKeepAlive(e.target.value)}
                  />
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-medium text-muted-foreground">
                  默认终端类型
                </label>
                <Select
                  value={defaultTermType}
                  onValueChange={(value) => setDefaultTermType(value ?? '')}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="xterm-256color">
                      xterm-256color
                    </SelectItem>
                    <SelectItem value="xterm">xterm</SelectItem>
                    <SelectItem value="vt100">vt100</SelectItem>
                    <SelectItem value="linux">linux</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </Button>
              </div>
            </form>
          </TabsContent>
          <TabsContent value="appearance">
            <ThemeEditor theme={theme} onSave={onSaveTheme} />
          </TabsContent>
          <TabsContent value="keys">
            <KeyManager
              keys={keys}
              onGenerate={onGenerateKey}
              onImport={onImportKey}
              onDelete={onDeleteKey}
              onExport={onExportKey}
            />
          </TabsContent>
          <TabsContent value="folders"><FolderManager folders={folders} sessions={sessions} onCreate={onCreateFolder} onRename={onRenameFolder} onSetDefault={onSetDefaultFolder} onDelete={onDeleteFolder} /></TabsContent>
          <TabsContent value="sync">
            <SyncPanel
              sync={sync}
              onSave={onSaveSync}
              onExport={onExportConfig}
              onImport={onImportConfig}
            />
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  )
}

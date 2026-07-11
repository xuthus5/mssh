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
import { LabeledSelect } from '@/components/ui/labeled-select'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { KeyManager } from '@/components/settings/KeyManager'
import { SyncPanel } from '@/components/settings/SyncPanel'
import type { GeneralSettings, TerminalTheme, KeyInfo, SyncConfig } from '@/hooks/useSettings'
import type { Folder, Session } from '@/hooks/useSession'
import { FolderManager } from '@/components/settings/FolderManager'
import { useDraggableDialog } from '@/hooks/useDraggableDialog'

const TERMINAL_TYPE_OPTIONS = ['xterm-256color', 'xterm', 'vt100', 'linux'].map((value) => ({ value, label: value }))

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
  const draggable = useDraggableDialog(open)

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
      <DialogContent ref={draggable.contentRef} style={draggable.style} className="flex h-[min(720px,calc(100dvh-3rem))] max-h-[calc(100dvh-3rem)] flex-col overflow-hidden sm:max-w-3xl">
        <DialogHeader data-testid="settings-drag-handle" {...draggable.dragHandleProps} className="-mx-4 -mt-4 cursor-move touch-none select-none rounded-t-xl border-b border-border px-4 py-3 active:cursor-grabbing">
          <DialogTitle>设置</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={setTab} orientation="vertical" className="min-h-0 flex-1 flex-row gap-4 overflow-hidden">
          <TabsList className="w-36 shrink-0 self-stretch justify-start rounded-xl border bg-muted/40 p-2">
            <TabsTrigger value="general">通用</TabsTrigger>
            <TabsTrigger value="appearance">外观</TabsTrigger>
            <TabsTrigger value="keys">密钥</TabsTrigger>
            <TabsTrigger value="folders">分组</TabsTrigger>
            <TabsTrigger value="sync">同步</TabsTrigger>
          </TabsList>
          <TabsContent value="general" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
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
                <LabeledSelect value={defaultTermType} options={TERMINAL_TYPE_OPTIONS} onValueChange={setDefaultTermType} />
              </div>
              <div className="flex justify-end">
                <Button type="submit" size="sm" disabled={saving}>
                  {saving ? '保存中...' : '保存'}
                </Button>
              </div>
            </form>
          </TabsContent>
          <TabsContent value="appearance" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
            <ThemeEditor theme={theme} onSave={onSaveTheme} />
          </TabsContent>
          <TabsContent value="keys" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
            <KeyManager
              keys={keys}
              onGenerate={onGenerateKey}
              onImport={onImportKey}
              onDelete={onDeleteKey}
              onExport={onExportKey}
            />
          </TabsContent>
          <TabsContent value="folders" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2"><FolderManager folders={folders} sessions={sessions} onCreate={onCreateFolder} onRename={onRenameFolder} onSetDefault={onSetDefaultFolder} onDelete={onDeleteFolder} /></TabsContent>
          <TabsContent value="sync" className="min-h-0 min-w-0 overflow-y-auto overscroll-contain pr-2">
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

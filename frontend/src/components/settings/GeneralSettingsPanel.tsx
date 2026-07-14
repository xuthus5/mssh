import { useEffect, useState, type FormEvent } from 'react'
import { CircleHelp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { Slider } from '@/components/ui/slider'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import type { GeneralSettings } from '@/hooks/useSettings'

const TERMINAL_TYPE_OPTIONS = ['xterm-256color', 'xterm', 'vt100', 'linux'].map((value) => ({ value, label: value }))

interface GeneralDraft {
  maxPoolSize: string
  defaultKeepAlive: string
  defaultTermType: string
  uiFontFamily: string
  uiFontFallbackFamily: string
  uiFontSize: string
  windowOpacity: string
  rightClickAction: GeneralSettings['rightClickAction']
  copyOnSelect: boolean
}

interface Props {
  general: GeneralSettings
  systemFonts: string[]
  onSave: (settings: GeneralSettings) => Promise<void>
  onPreviewUIFont: (fontFamily: string, fallbackFamily: string, fontSize: number) => void
  onPreviewWindowOpacity: (opacity: number) => void
  onDirtyChange: (dirty: boolean) => void
}

function createDraft(general: GeneralSettings): GeneralDraft {
  return {
    maxPoolSize: String(general.maxPoolSize), defaultKeepAlive: String(general.defaultKeepAlive),
    defaultTermType: general.defaultTermType, uiFontFamily: general.uiFontFamily,
    uiFontFallbackFamily: general.uiFontFallbackFamily, uiFontSize: String(general.uiFontSize),
    windowOpacity: String(general.windowOpacity), rightClickAction: general.rightClickAction,
    copyOnSelect: general.copyOnSelect,
  }
}

function ConnectionDefaults({ draft, setDraft }: { draft: GeneralDraft; setDraft: (draft: GeneralDraft) => void }) {
  return <>
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">最大终端池大小</label>
        <Input type="number" value={draft.maxPoolSize} onChange={(event) => setDraft({ ...draft, maxPoolSize: event.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">默认保活间隔 (秒)</label>
        <Input type="number" value={draft.defaultKeepAlive} onChange={(event) => setDraft({ ...draft, defaultKeepAlive: event.target.value })} />
      </div>
    </div>
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">默认终端类型</label>
      <LabeledSelect value={draft.defaultTermType} options={TERMINAL_TYPE_OPTIONS} onValueChange={(value) => setDraft({ ...draft, defaultTermType: value })} />
    </div>
  </>
}

function UIFontSettings({ draft, systemFonts, onChange }: {
  draft: GeneralDraft
  systemFonts: string[]
  onChange: (draft: GeneralDraft) => void
}) {
  const primaryOptions = systemFonts.includes(draft.uiFontFamily) ? systemFonts : [draft.uiFontFamily, ...systemFonts]
  const fallbackOptions = systemFonts.includes(draft.uiFontFallbackFamily) ? systemFonts : [draft.uiFontFallbackFamily, ...systemFonts]
  return <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <div className="mb-3"><h3 className="text-sm font-medium text-foreground">界面字体</h3><p className="mt-1 text-xs text-muted-foreground">仅调整应用界面。终端排版请在“终端”分类中配置。</p></div>
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">字体类型</label>
        <SearchableSelect ariaLabel="界面字体" value={draft.uiFontFamily} options={primaryOptions} onValueChange={(value) => onChange({ ...draft, uiFontFamily: value, uiFontFallbackFamily: value === draft.uiFontFallbackFamily ? 'sans-serif' : draft.uiFontFallbackFamily })} placeholder="搜索系统字体" />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">Fallback 字体</label>
        <SearchableSelect ariaLabel="Fallback 字体" value={draft.uiFontFallbackFamily} options={fallbackOptions} disabledValues={[draft.uiFontFamily]} onValueChange={(value) => onChange({ ...draft, uiFontFallbackFamily: value })} placeholder="搜索备用字体" />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ui-font-size" className="text-xs font-medium text-muted-foreground">界面字号</label>
        <Input id="ui-font-size" type="number" min={12} max={24} value={draft.uiFontSize} onChange={(event) => onChange({ ...draft, uiFontSize: event.target.value })} />
      </div>
    </div>
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2" style={{ fontFamily: `${JSON.stringify(draft.uiFontFamily)}, ${JSON.stringify(draft.uiFontFallbackFamily)}, sans-serif`, fontSize: `${parseInt(draft.uiFontSize, 10) || 14}px` }}>
      <p className="text-foreground">MSSH 安全连接 · Secure Shell 0123456789 → ✓ ★</p><p className="mt-1 text-xs text-muted-foreground">中文、English、数字与符号预览</p>
    </div>
  </section>
}

function WindowOpacitySettings({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const opacity = parseInt(value, 10) || 100
  return <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
    <div className="mb-3 flex items-center gap-1.5">
      <div><h3 className="text-sm font-medium text-foreground">应用透明度</h3><p className="mt-1 text-xs text-muted-foreground">调整整个应用窗口的显示透明度。</p></div>
      <Tooltip><TooltipTrigger render={<button type="button" aria-label="透明度兼容性说明" className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-foreground" />}><CircleHelp className="size-3.5" /></TooltipTrigger><TooltipContent>部分桌面环境不支持窗口透明度合成显示。</TooltipContent></Tooltip>
    </div>
    <div className="grid grid-cols-[minmax(0,1fr)_6rem] items-center gap-3">
      <Slider aria-label="应用透明度" min={50} max={100} step={1} value={[opacity]} onValueChange={(next) => onChange(String(Array.isArray(next) ? next[0] : next))} />
      <div className="relative"><Input aria-label="应用透明度百分比" type="number" min={50} max={100} value={value} className="pr-7" onChange={(event) => onChange(event.target.value)} /><span className="pointer-events-none absolute inset-y-0 right-2 flex items-center text-xs text-muted-foreground">%</span></div>
    </div>
  </section>
}

export function GeneralSettingsPanel({ general, systemFonts, onSave, onPreviewUIFont, onPreviewWindowOpacity, onDirtyChange }: Props) {
  const [draft, setDraft] = useState(() => createDraft(general))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(createDraft(general)); onDirtyChange(false) }, [general, onDirtyChange])
  const previewDraft = (next: GeneralDraft) => {
    setDraft(next)
    onDirtyChange(true)
    onPreviewUIFont(next.uiFontFamily, next.uiFontFallbackFamily, parseInt(next.uiFontSize, 10) || 14)
  }
  const previewOpacity = (value: string) => {
    setDraft({ ...draft, windowOpacity: value })
    onDirtyChange(true)
    onPreviewWindowOpacity(parseInt(value, 10) || 100)
  }
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      await onSave({ maxPoolSize: parseInt(draft.maxPoolSize, 10) || 10, defaultKeepAlive: parseInt(draft.defaultKeepAlive, 10) || 60, defaultTermType: draft.defaultTermType, uiFontFamily: draft.uiFontFamily, uiFontFallbackFamily: draft.uiFontFallbackFamily, uiFontSize: parseInt(draft.uiFontSize, 10) || 14, windowOpacity: parseInt(draft.windowOpacity, 10) || 100, rightClickAction: draft.rightClickAction, copyOnSelect: draft.copyOnSelect })
      onDirtyChange(false)
    } finally { setSaving(false) }
  }
  return <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2">
    <ConnectionDefaults draft={draft} setDraft={setDraft} />
    <TerminalBehaviorSettingsSection rightClickAction={draft.rightClickAction} copyOnSelect={draft.copyOnSelect} onRightClickActionChange={(value) => setDraft({ ...draft, rightClickAction: value })} onCopyOnSelectChange={(value) => setDraft({ ...draft, copyOnSelect: value })} />
    <UIFontSettings draft={draft} systemFonts={systemFonts} onChange={previewDraft} />
    <WindowOpacitySettings value={draft.windowOpacity} onChange={previewOpacity} />
    <div className="flex justify-end"><Button type="submit" size="sm" disabled={saving}>{saving ? '保存中...' : '保存'}</Button></div>
  </form>
}

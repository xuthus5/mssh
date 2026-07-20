import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import { ApplicationBehaviorSettingsSection } from '@/components/settings/ApplicationBehaviorSettings'
import type { GeneralSettings } from '@/hooks/useSettings'

const TERMINAL_TYPE_OPTIONS = ['xterm-256color', 'xterm', 'vt100', 'linux'].map((value) => ({ value, label: value }))

interface GeneralDraft {
  maxPoolSize: string
  defaultKeepAlive: string
  defaultTermType: string
  uiFontFamily: string
  uiFontFallbackFamily: string
  uiFontSize: string
  rightClickAction: GeneralSettings['rightClickAction']
  copyOnSelect: boolean
  closeButtonAction: GeneralSettings['closeButtonAction']
}

interface Props {
  general: GeneralSettings
  systemFonts: string[]
  onSave: (settings: GeneralSettings) => Promise<void>
  onPreviewUIFont: (fontFamily: string, fallbackFamily: string, fontSize: number) => void
}

function createDraft(general: GeneralSettings): GeneralDraft {
  return {
    maxPoolSize: String(general.maxPoolSize), defaultKeepAlive: String(general.defaultKeepAlive),
    defaultTermType: general.defaultTermType, uiFontFamily: general.uiFontFamily,
    uiFontFallbackFamily: general.uiFontFallbackFamily, uiFontSize: String(general.uiFontSize),
    rightClickAction: general.rightClickAction,
    copyOnSelect: general.copyOnSelect,
    closeButtonAction: general.closeButtonAction,
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
        <Input type="number" min={1} value={draft.defaultKeepAlive} onChange={(event) => setDraft({ ...draft, defaultKeepAlive: event.target.value })} />
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

export function GeneralSettingsPanel({ general, systemFonts, onSave, onPreviewUIFont }: Props) {
  const [draft, setDraft] = useState(() => createDraft(general))
  const [saving, setSaving] = useState(false)
  useEffect(() => { setDraft(createDraft(general)) }, [general])
  const previewDraft = (next: GeneralDraft) => {
    setDraft(next)
    onPreviewUIFont(next.uiFontFamily, next.uiFontFallbackFamily, parseInt(next.uiFontSize, 10) || 14)
  }
  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      await onSave({ maxPoolSize: parseInt(draft.maxPoolSize, 10) || 10, defaultKeepAlive: parseInt(draft.defaultKeepAlive, 10) || 60, defaultTermType: draft.defaultTermType, uiFontFamily: draft.uiFontFamily, uiFontFallbackFamily: draft.uiFontFallbackFamily, uiFontSize: parseInt(draft.uiFontSize, 10) || 14, rightClickAction: draft.rightClickAction, copyOnSelect: draft.copyOnSelect, closeButtonAction: draft.closeButtonAction })
    } finally { setSaving(false) }
  }
  return <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2">
    <ConnectionDefaults draft={draft} setDraft={setDraft} />
    <ApplicationBehaviorSettingsSection closeButtonAction={draft.closeButtonAction} onCloseButtonActionChange={(value) => setDraft({ ...draft, closeButtonAction: value })} />
    <TerminalBehaviorSettingsSection rightClickAction={draft.rightClickAction} copyOnSelect={draft.copyOnSelect} onRightClickActionChange={(value) => setDraft({ ...draft, rightClickAction: value })} onCopyOnSelectChange={(value) => setDraft({ ...draft, copyOnSelect: value })} />
    <UIFontSettings draft={draft} systemFonts={systemFonts} onChange={previewDraft} />
    <div className="flex justify-end"><Button type="submit" size="sm" disabled={saving}>{saving ? '保存中...' : '保存'}</Button></div>
  </form>
}

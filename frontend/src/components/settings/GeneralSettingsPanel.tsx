import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import { ApplicationBehaviorSettingsSection } from '@/components/settings/ApplicationBehaviorSettings'
import { ApplicationLogSettingsSection } from '@/components/settings/ApplicationLogSettings'
import type { GeneralSettings } from '@/hooks/useSettings'
import { t } from '@/i18n'


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
  scrollbackLines: string
  closeButtonAction: GeneralSettings['closeButtonAction']
  logDir: string
  logRetentionDays: string
  language: GeneralSettings['language']
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
    scrollbackLines: String(general.scrollbackLines),
    closeButtonAction: general.closeButtonAction,
    logDir: general.logDir,
    logRetentionDays: String(general.logRetentionDays),
    language: general.language,
  }
}

function ConnectionDefaults({ draft, setDraft }: { draft: GeneralDraft; setDraft: (draft: GeneralDraft) => void }) {
  return <>
    <div className="grid grid-cols-2 gap-3">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t('最大终端池大小')}</label>
        <Input type="number" value={draft.maxPoolSize} onChange={(event) => setDraft({ ...draft, maxPoolSize: event.target.value })} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t('默认保活间隔 (秒)')}</label>
        <Input type="number" min={1} value={draft.defaultKeepAlive} onChange={(event) => setDraft({ ...draft, defaultKeepAlive: event.target.value })} />
      </div>
    </div>
    <div className="flex flex-col gap-1.5">
      <label className="text-xs font-medium text-muted-foreground">{t('默认终端类型')}</label>
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
    <div className="mb-3"><h3 className="text-sm font-medium text-foreground">{t('界面字体')}</h3><p className="mt-1 text-xs text-muted-foreground">{t('仅调整应用界面。终端排版请在“终端”分类中配置。')}</p></div>
    <div className="grid grid-cols-2 gap-3">
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t('字体类型')}</label>
        <SearchableSelect ariaLabel={t('界面字体')} value={draft.uiFontFamily} options={primaryOptions} onValueChange={(value) => onChange({ ...draft, uiFontFamily: value, uiFontFallbackFamily: value === draft.uiFontFallbackFamily ? 'sans-serif' : draft.uiFontFallbackFamily })} placeholder={t('搜索系统字体')} />
      </div>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t('Fallback 字体')}</label>
        <SearchableSelect ariaLabel={t('Fallback 字体')} value={draft.uiFontFallbackFamily} options={fallbackOptions} disabledValues={[draft.uiFontFamily]} onValueChange={(value) => onChange({ ...draft, uiFontFallbackFamily: value })} placeholder={t('搜索备用字体')} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="ui-font-size" className="text-xs font-medium text-muted-foreground">{t('界面字号')}</label>
        <Input id="ui-font-size" type="number" min={12} max={24} value={draft.uiFontSize} onChange={(event) => onChange({ ...draft, uiFontSize: event.target.value })} />
      </div>
    </div>
    <div className="mt-3 rounded-lg border border-border bg-background px-3 py-2" style={{ fontFamily: `${JSON.stringify(draft.uiFontFamily)}, ${JSON.stringify(draft.uiFontFallbackFamily)}, sans-serif`, fontSize: `${parseInt(draft.uiFontSize, 10) || 14}px` }}>
      <p className="text-foreground">{t('MSSH 安全连接 · Secure Shell 0123456789 → ✓ ★')}</p><p className="mt-1 text-xs text-muted-foreground">{t('中文、English、数字与符号预览')}</p>
    </div>
  </section>
}


function LanguageSettings({ draft, setDraft }: { draft: GeneralDraft; setDraft: (draft: GeneralDraft) => void }) {
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('界面语言')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t('选择应用界面显示语言。')}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted-foreground">{t('语言')}</label>
        <LabeledSelect
          ariaLabel={t('界面语言')}
          value={draft.language}
          options={[
            { value: 'zh-CN', label: t('中文（简体）') },
            { value: 'en', label: 'English' },
          ]}
          onValueChange={(value) => setDraft({ ...draft, language: value === 'en' ? 'en' : 'zh-CN' })}
        />
      </div>
    </section>
  )
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
      await onSave({ maxPoolSize: parseInt(draft.maxPoolSize, 10) || 10, defaultKeepAlive: parseInt(draft.defaultKeepAlive, 10) || 60, defaultTermType: draft.defaultTermType, uiFontFamily: draft.uiFontFamily, uiFontFallbackFamily: draft.uiFontFallbackFamily, uiFontSize: parseInt(draft.uiFontSize, 10) || 14, rightClickAction: draft.rightClickAction, copyOnSelect: draft.copyOnSelect, scrollbackLines: parseInt(draft.scrollbackLines, 10) || 10000, closeButtonAction: draft.closeButtonAction, logDir: draft.logDir.trim(), logRetentionDays: parseInt(draft.logRetentionDays, 10) || 30, language: draft.language })
    } finally { setSaving(false) }
  }
  return <form onSubmit={handleSubmit} className="flex flex-col gap-3 pt-2">
    <ConnectionDefaults draft={draft} setDraft={setDraft} />
    <LanguageSettings draft={draft} setDraft={setDraft} />
    <ApplicationBehaviorSettingsSection closeButtonAction={draft.closeButtonAction} onCloseButtonActionChange={(value) => setDraft({ ...draft, closeButtonAction: value })} />
    <ApplicationLogSettingsSection logDir={draft.logDir} logRetentionDays={draft.logRetentionDays} onLogDirChange={(value) => setDraft({ ...draft, logDir: value })} onLogRetentionDaysChange={(value) => setDraft({ ...draft, logRetentionDays: value })} />
    <TerminalBehaviorSettingsSection rightClickAction={draft.rightClickAction} copyOnSelect={draft.copyOnSelect} scrollbackLines={draft.scrollbackLines} onRightClickActionChange={(value) => setDraft({ ...draft, rightClickAction: value })} onCopyOnSelectChange={(value) => setDraft({ ...draft, copyOnSelect: value })} onScrollbackLinesChange={(value) => setDraft({ ...draft, scrollbackLines: value > 0 ? String(value) : '' })} />
    <UIFontSettings draft={draft} systemFonts={systemFonts} onChange={previewDraft} />
    <div className="flex justify-end"><Button type="submit" size="sm" disabled={saving}>{saving ? t('保存中...') : t('保存')}</Button></div>
  </form>
}

import { useCallback, useEffect, useState } from 'react'
import { Input } from '@/components/ui/input'
import { LabeledSelect } from '@/components/ui/labeled-select'
import { SearchableSelect } from '@/components/ui/searchable-select'
import { ApplicationBehaviorSettingsSection } from '@/components/settings/ApplicationBehaviorSettings'
import { ApplicationLogSettingsSection } from '@/components/settings/ApplicationLogSettings'
import { ApplicationNetworkProxySettingsSection } from '@/components/settings/ApplicationNetworkProxySettings'
import { AutoSaveStatusIndicator } from '@/components/settings/AutoSaveStatus'
import { useAutoSave } from '@/hooks/useAutoSave'
import type { GeneralSettings } from '@/hooks/useSettings'
import { t } from '@/i18n'

interface GeneralDraft {
  uiFontFamily: string
  uiFontFallbackFamily: string
  uiFontSize: string
  closeButtonAction: GeneralSettings['closeButtonAction']
  logDir: string
  logRetentionDays: string
  proxyMode: GeneralSettings['proxyMode']
  proxyURL: string
  proxyNoProxy: string
  proxyUsername: string
  proxyPassword: string
  proxyPasswordSaved: boolean
  clearProxyPassword: boolean
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
    uiFontFamily: general.uiFontFamily,
    uiFontFallbackFamily: general.uiFontFallbackFamily,
    uiFontSize: String(general.uiFontSize),
    closeButtonAction: general.closeButtonAction,
    logDir: general.logDir,
    logRetentionDays: String(general.logRetentionDays),
    proxyMode: general.proxyMode,
    proxyURL: general.proxyURL,
    proxyNoProxy: general.proxyNoProxy,
    proxyUsername: general.proxyUsername,
    proxyPassword: '',
    proxyPasswordSaved: general.proxyPasswordSaved,
    clearProxyPassword: false,
    language: general.language,
  }
}

function buildSavePayload(general: GeneralSettings, draft: GeneralDraft): GeneralSettings {
  return {
    ...general,
    uiFontFamily: draft.uiFontFamily,
    uiFontFallbackFamily: draft.uiFontFallbackFamily,
    uiFontSize: parseInt(draft.uiFontSize, 10) || 14,
    closeButtonAction: draft.closeButtonAction,
    logDir: draft.logDir.trim(),
    logRetentionDays: parseInt(draft.logRetentionDays, 10) || 30,
    proxyMode: draft.proxyMode,
    proxyURL: draft.proxyURL.trim(),
    proxyNoProxy: draft.proxyNoProxy.trim(),
    proxyUsername: draft.proxyUsername.trim(),
    proxyPassword: draft.clearProxyPassword ? '' : draft.proxyPassword,
    proxyPasswordSaved: draft.clearProxyPassword ? false : (draft.proxyPasswordSaved || draft.proxyPassword.trim() !== ''),
    clearProxyPassword: draft.clearProxyPassword,
    language: draft.language,
  }
}

function UIFontSettings({
  draft,
  systemFonts,
  onChange,
}: {
  draft: GeneralDraft
  systemFonts: string[]
  onChange: (draft: GeneralDraft) => void
}) {
  const primaryOptions = systemFonts.includes(draft.uiFontFamily)
    ? systemFonts
    : [draft.uiFontFamily, ...systemFonts]
  const fallbackOptions = systemFonts.includes(draft.uiFontFallbackFamily)
    ? systemFonts
    : [draft.uiFontFallbackFamily, ...systemFonts]
  return (
    <section className="rounded-xl border border-border bg-card p-3 shadow-sm">
      <div className="mb-3">
        <h3 className="text-sm font-medium text-foreground">{t('界面字体')}</h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {t('仅调整应用界面。终端排版请在“终端”分类中配置。')}
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('字体类型')}</label>
          <SearchableSelect
            ariaLabel={t('界面字体')}
            value={draft.uiFontFamily}
            options={primaryOptions}
            onValueChange={(value) =>
              onChange({
                ...draft,
                uiFontFamily: value,
                uiFontFallbackFamily:
                  value === draft.uiFontFallbackFamily ? 'sans-serif' : draft.uiFontFallbackFamily,
              })
            }
            placeholder={t('搜索系统字体')}
          />
        </div>
        <div className="flex min-w-0 flex-col gap-1.5">
          <label className="text-xs font-medium text-muted-foreground">{t('Fallback 字体')}</label>
          <SearchableSelect
            ariaLabel={t('Fallback 字体')}
            value={draft.uiFontFallbackFamily}
            options={fallbackOptions}
            disabledValues={[draft.uiFontFamily]}
            onValueChange={(value) => onChange({ ...draft, uiFontFallbackFamily: value })}
            placeholder={t('搜索备用字体')}
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <label htmlFor="ui-font-size" className="text-xs font-medium text-muted-foreground">
            {t('界面字号')}
          </label>
          <Input
            id="ui-font-size"
            type="number"
            min={12}
            max={24}
            value={draft.uiFontSize}
            onChange={(event) => onChange({ ...draft, uiFontSize: event.target.value })}
          />
        </div>
      </div>
      <div
        className="mt-3 rounded-lg border border-border bg-background px-3 py-2"
        style={{
          fontFamily: `${JSON.stringify(draft.uiFontFamily)}, ${JSON.stringify(draft.uiFontFallbackFamily)}, sans-serif`,
          fontSize: `${parseInt(draft.uiFontSize, 10) || 14}px`,
        }}
      >
        <p className="text-foreground">{t('MSSH 安全连接 · Secure Shell 0123456789 → ✓ ★')}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t('中文、English、数字与符号预览')}</p>
      </div>
    </section>
  )
}

function LanguageSettings({
  draft,
  setDraft,
}: {
  draft: GeneralDraft
  setDraft: (draft: GeneralDraft) => void
}) {
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
  useEffect(() => {
    setDraft(createDraft(general))
  }, [general])

  const previewDraft = (next: GeneralDraft) => {
    setDraft(next)
    onPreviewUIFont(next.uiFontFamily, next.uiFontFallbackFamily, parseInt(next.uiFontSize, 10) || 14)
  }

  const persist = useCallback(
    async (next: GeneralDraft) => {
      await onSave(buildSavePayload(general, next))
    },
    [general, onSave],
  )
  const autoSave = useAutoSave({ value: draft, onSave: persist, delayMs: 450 })

  return (
    <div className="flex flex-col gap-3 pt-2">
      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">{t('通用设置包含界面外观与应用级偏好。')}</p>
        <AutoSaveStatusIndicator status={autoSave.status} error={autoSave.error} />
      </div>
      <LanguageSettings draft={draft} setDraft={setDraft} />
      <UIFontSettings draft={draft} systemFonts={systemFonts} onChange={previewDraft} />
      <ApplicationBehaviorSettingsSection
        closeButtonAction={draft.closeButtonAction}
        onCloseButtonActionChange={(value) => setDraft({ ...draft, closeButtonAction: value })}
      />
      <ApplicationLogSettingsSection
        logDir={draft.logDir}
        logRetentionDays={draft.logRetentionDays}
        onLogDirChange={(value) => setDraft({ ...draft, logDir: value })}
        onLogRetentionDaysChange={(value) => setDraft({ ...draft, logRetentionDays: value })}
      />
      <ApplicationNetworkProxySettingsSection
        proxyMode={draft.proxyMode}
        proxyURL={draft.proxyURL}
        proxyNoProxy={draft.proxyNoProxy}
        proxyUsername={draft.proxyUsername}
        proxyPassword={draft.proxyPassword}
        proxyPasswordSaved={draft.proxyPasswordSaved}
        clearProxyPassword={draft.clearProxyPassword}
        onProxyModeChange={(value) => setDraft({ ...draft, proxyMode: value })}
        onProxyURLChange={(value) => setDraft({ ...draft, proxyURL: value })}
        onProxyNoProxyChange={(value) => setDraft({ ...draft, proxyNoProxy: value })}
        onProxyUsernameChange={(value) => setDraft({ ...draft, proxyUsername: value })}
        onProxyPasswordChange={(value) => setDraft({ ...draft, proxyPassword: value, clearProxyPassword: false })}
        onClearProxyPasswordChange={(value) => setDraft({
          ...draft,
          clearProxyPassword: value,
          proxyPassword: value ? '' : draft.proxyPassword,
        })}
      />
    </div>
  )
}

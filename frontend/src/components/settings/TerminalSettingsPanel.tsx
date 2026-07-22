import { useEffect, useState, type FormEvent } from 'react'
import { Button } from '@/components/ui/button'
import { TerminalBehaviorSettingsSection } from '@/components/settings/TerminalBehaviorSettings'
import { TerminalConnectionDefaultsSettingsSection } from '@/components/settings/TerminalConnectionDefaultsSettings'
import { ThemeEditor } from '@/components/settings/ThemeEditor'
import { ThemeManager } from '@/components/settings/ThemeManager'
import type { GeneralSettings } from '@/hooks/useSettings'
import type { ColorMode } from '@/lib/effectiveTerminalTheme'
import type {
  BuiltinThemeResetResult,
  TerminalGlobalStyle,
  ThemeAssignments,
  ThemeConfigurationInput,
  ThemeImportSummary,
  ThemeProfile,
  ThemeProfileInput,
} from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

interface TerminalDraft {
  maxPoolSize: string
  defaultKeepAlive: string
  defaultTermType: string
  rightClickAction: GeneralSettings['rightClickAction']
  copyOnSelect: boolean
  scrollbackLines: string
}

interface Props {
  general: GeneralSettings
  themeProfiles: ThemeProfile[]
  themeAssignments: ThemeAssignments
  terminalGlobalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  onSaveGeneral: (settings: GeneralSettings) => Promise<void>
  onSaveThemeConfiguration: (configuration: ThemeConfigurationInput) => Promise<void>
  onImportThemes: (paths: string[]) => Promise<ThemeImportSummary>
  onCreateThemeProfile: (profile: ThemeProfileInput) => Promise<ThemeProfile | null>
  onUpdateThemeProfile: (profile: ThemeProfileInput) => Promise<void>
  onDeleteThemeProfile: (id: number) => Promise<void>
  onDeleteThemeDefinition: (id: number) => Promise<void>
  onResetBuiltinThemes: () => Promise<BuiltinThemeResetResult>
}

function createDraft(general: GeneralSettings): TerminalDraft {
  return {
    maxPoolSize: String(general.maxPoolSize),
    defaultKeepAlive: String(general.defaultKeepAlive),
    defaultTermType: general.defaultTermType,
    rightClickAction: general.rightClickAction,
    copyOnSelect: general.copyOnSelect,
    scrollbackLines: String(general.scrollbackLines),
  }
}

function buildSavePayload(general: GeneralSettings, draft: TerminalDraft): GeneralSettings {
  return {
    ...general,
    maxPoolSize: parseInt(draft.maxPoolSize, 10) || 10,
    defaultKeepAlive: parseInt(draft.defaultKeepAlive, 10) || 60,
    defaultTermType: draft.defaultTermType,
    rightClickAction: draft.rightClickAction,
    copyOnSelect: draft.copyOnSelect,
    scrollbackLines: parseInt(draft.scrollbackLines, 10) || 10000,
  }
}

export function TerminalSettingsPanel({
  general,
  themeProfiles,
  themeAssignments,
  terminalGlobalStyle,
  colorMode,
  onSaveGeneral,
  onSaveThemeConfiguration,
  onImportThemes,
  onCreateThemeProfile,
  onUpdateThemeProfile,
  onDeleteThemeProfile,
  onDeleteThemeDefinition,
  onResetBuiltinThemes,
}: Props) {
  const [draft, setDraft] = useState(() => createDraft(general))
  const [saving, setSaving] = useState(false)
  useEffect(() => {
    setDraft(createDraft(general))
  }, [general])

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault()
    setSaving(true)
    try {
      await onSaveGeneral(buildSavePayload(general, draft))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col gap-5 pt-2">
      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <TerminalConnectionDefaultsSettingsSection
          maxPoolSize={draft.maxPoolSize}
          defaultKeepAlive={draft.defaultKeepAlive}
          defaultTermType={draft.defaultTermType}
          onMaxPoolSizeChange={(value) => setDraft({ ...draft, maxPoolSize: value })}
          onDefaultKeepAliveChange={(value) => setDraft({ ...draft, defaultKeepAlive: value })}
          onDefaultTermTypeChange={(value) => setDraft({ ...draft, defaultTermType: value })}
        />
        <TerminalBehaviorSettingsSection
          rightClickAction={draft.rightClickAction}
          copyOnSelect={draft.copyOnSelect}
          scrollbackLines={draft.scrollbackLines}
          onRightClickActionChange={(value) => setDraft({ ...draft, rightClickAction: value })}
          onCopyOnSelectChange={(value) => setDraft({ ...draft, copyOnSelect: value })}
          onScrollbackLinesChange={(value) =>
            setDraft({ ...draft, scrollbackLines: value > 0 ? String(value) : '' })
          }
        />
        <div className="flex justify-end">
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? t('保存中...') : t('保存')}
          </Button>
        </div>
      </form>
      <ThemeEditor
        profiles={themeProfiles}
        assignments={themeAssignments}
        globalStyle={terminalGlobalStyle}
        colorMode={colorMode}
        onSave={onSaveThemeConfiguration}
        onResetBuiltins={onResetBuiltinThemes}
      />
      <ThemeManager
        profiles={themeProfiles}
        onImport={onImportThemes}
        onCreateProfile={onCreateThemeProfile}
        onUpdateProfile={onUpdateThemeProfile}
        onDeleteProfile={onDeleteThemeProfile}
        onDeleteDefinition={onDeleteThemeDefinition}
      />
    </div>
  )
}

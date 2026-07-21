import { useEffect, useState, type FormEvent } from 'react'
import { RotateCcw, Save, SquareTerminal } from 'lucide-react'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import { Switch } from '@/components/ui/switch'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { AnsiPaletteEditor } from '@/components/settings/AnsiPaletteEditor'
import { TerminalGlobalStyleEditor } from '@/components/settings/TerminalGlobalStyleEditor'
import { TerminalProfileStyleEditor } from '@/components/settings/TerminalProfileStyleEditor'
import { TerminalThemeInspector } from '@/components/settings/TerminalThemeInspector'
import { TerminalThemePreview } from '@/components/settings/TerminalThemePreview'
import { ThemeModeSelector } from '@/components/settings/ThemeModeSelector'
import { buildThemeConfiguration, configurationProfileIDs, createThemeDrafts, effectiveDraftTheme, profileIDForSlot, validTerminalFontFamily, validTerminalFontSize, type ThemeDraft, type ThemeEditorSlot } from '@/components/settings/themeEditorState'
import { hasValidTerminalThemeColors, isHexColor } from '@/components/settings/terminalThemeValidation'
import type { ColorMode } from '@/lib/effectiveTerminalTheme'
import type { TerminalTheme } from '@/hooks/useSettings'
import type { BuiltinThemeResetResult, TerminalGlobalStyle, ThemeAssignments, ThemeConfigurationInput, ThemeProfile } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'


interface Props {
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  globalStyle: TerminalGlobalStyle
  colorMode: ColorMode
  onSave: (configuration: ThemeConfigurationInput) => Promise<void> | void
  onResetBuiltins: () => Promise<BuiltinThemeResetResult>
}

export function ThemeEditor({ profiles, assignments, globalStyle, colorMode, onSave, onResetBuiltins }: Props) {
  const state = useThemeEditorDraftState(profiles, assignments, globalStyle)
  const submission = useThemeConfigurationSubmit(state, profiles, onSave)
  const activeProfileID = profileIDForSlot(state.editorSlot, state.draftAssignments)
  const activeProfile = findProfile(profiles, activeProfileID)
  const activeTheme = state.drafts.get(activeProfileID)
  if (!activeProfile || !activeTheme) return <p className="text-sm text-muted-foreground">{t('终端主题配置不可用，请重新加载设置。')}</p>
  const actions = themeEditorActions(state, activeProfileID, colorMode)
  const busy = submission.saving || state.resetting
  const effectiveTheme = effectiveDraftTheme(activeTheme, state.draftGlobalStyle)
  const valid = themeConfigurationValid(state.drafts, state.draftAssignments, state.draftGlobalStyle)
  const canReset = canResetBuiltinProfiles(profiles, assignments)
  const mismatch = !state.draftAssignments.follow_interface_mode && activeProfile.definition?.mode !== 'universal' && activeProfile.definition?.mode !== colorMode
  const sharedLabels = !state.draftAssignments.follow_interface_mode ? fixedProfileSharing(state.draftAssignments) : []

  return <form onSubmit={submission.submit} className="flex flex-col gap-5 pb-2 pt-2">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-foreground">{t('终端主题')}</h2><p className="text-sm text-muted-foreground">{t('选择终端是否跟随应用模式，或固定使用一个独立主题。')}</p></div><BuiltinThemeResetControl canReset={canReset} dirty={state.dirty} saving={submission.saving} resetting={state.resetting} includesFixed={!assignments.follow_interface_mode} onResettingChange={state.setResetting} onReset={onResetBuiltins} /></div>
    <ThemeStrategyCard assignments={state.draftAssignments} busy={busy} onFollowChange={actions.setFollowInterfaceMode} />
    <TerminalGlobalStyleEditor style={state.draftGlobalStyle} disabled={busy} onChange={actions.updateGlobalStyle} />
    <ThemeAssignmentCard profiles={profiles} assignments={state.draftAssignments} busy={busy} onSelect={actions.selectProfile} />
    {mismatch && <Alert><AlertDescription>{t('该终端主题为')} {activeProfile.definition?.mode === 'dark' ? 'Dark' : 'Light'} {t('类型，当前界面为')} {colorMode === 'dark' ? 'Dark' : 'Light'} {t('Mode。终端颜色将保持固定，不受界面模式影响。')}</AlertDescription></Alert>}
    <ThemeWorkspace profile={activeProfile} draft={activeTheme} effectiveTheme={effectiveTheme} globalStyle={state.draftGlobalStyle} editorSlot={state.editorSlot} followInterfaceMode={state.draftAssignments.follow_interface_mode} sharedLabels={sharedLabels} busy={busy} onEditorSlotChange={state.setEditorSlot} onThemeChange={actions.updateTheme} onProfileStyleChange={actions.updateProfileStyle} onAnsiChange={actions.updateAnsi} />
    <div className="flex justify-end"><Button type="submit" disabled={!valid || busy}><Save data-icon="inline-start" />{submission.saving ? t('保存中...') : t('保存主题配置')}</Button></div>
  </form>
}

function useThemeEditorDraftState(profiles: ThemeProfile[], assignments: ThemeAssignments, globalStyle: TerminalGlobalStyle) {
  const [editorSlot, setEditorSlot] = useState<ThemeEditorSlot>(assignments.follow_interface_mode ? 'dark' : 'fixed')
  const [draftAssignments, setDraftAssignments] = useState(assignments)
  const [drafts, setDrafts] = useState(() => createThemeDrafts(profiles))
  const [draftGlobalStyle, setDraftGlobalStyle] = useState(globalStyle)
  const [resetting, setResetting] = useState(false)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setDraftAssignments(assignments)
    setDrafts(createThemeDrafts(profiles))
    setDraftGlobalStyle(globalStyle)
    setEditorSlot(assignments.follow_interface_mode ? 'dark' : 'fixed')
    setDirty(false)
  }, [profiles, assignments, globalStyle])

  return { editorSlot, setEditorSlot, draftAssignments, setDraftAssignments, drafts, setDrafts, draftGlobalStyle, setDraftGlobalStyle, resetting, setResetting, dirty, setDirty }
}

type ThemeEditorDraftState = ReturnType<typeof useThemeEditorDraftState>

function themeEditorActions(state: ThemeEditorDraftState, activeProfileID: number, colorMode: ColorMode) {
  const updateTheme = <Key extends keyof TerminalTheme>(key: Key, value: TerminalTheme[Key]) => {
    state.setDirty(true)
    state.setDrafts((current) => {
      const currentTheme = current.get(activeProfileID)
      if (!currentTheme) return current
      return new Map(current).set(activeProfileID, { ...currentTheme, [key]: value })
    })
  }
  const updateProfileStyle = (draft: ThemeDraft) => {
    state.setDirty(true)
    state.setDrafts((current) => new Map(current).set(activeProfileID, draft))
  }
  const updateGlobalStyle = <Key extends keyof TerminalGlobalStyle>(key: Key, value: TerminalGlobalStyle[Key]) => {
    state.setDirty(true)
    state.setDraftGlobalStyle((current) => ({ ...current, [key]: value }))
  }
  const updateAnsi = (index: number, color: string) => {
    state.setDirty(true)
    state.setDrafts((current) => {
      const currentTheme = current.get(activeProfileID)
      if (!currentTheme) return current
      const ansi = currentTheme.ansi.map((item, itemIndex) => itemIndex === index ? color : item)
      return new Map(current).set(activeProfileID, { ...currentTheme, ansi })
    })
  }
  const selectProfile = (slot: ThemeEditorSlot, id: number) => {
    state.setDirty(true)
    const key = slot === 'dark' ? 'dark_profile_id' : slot === 'light' ? 'light_profile_id' : 'fixed_profile_id'
    state.setDraftAssignments((current) => ({ ...current, [key]: id }))
    state.setEditorSlot(slot)
  }
  const setFollowInterfaceMode = (checked: boolean) => {
    state.setDirty(true)
    state.setDraftAssignments((current) => ({
      ...current,
      follow_interface_mode: checked,
      fixed_profile_id: current.fixed_profile_id || (colorMode === 'dark' ? current.dark_profile_id : current.light_profile_id),
    }))
    state.setEditorSlot(checked ? colorMode : 'fixed')
  }
  return { updateTheme, updateProfileStyle, updateGlobalStyle, updateAnsi, selectProfile, setFollowInterfaceMode }
}

function useThemeConfigurationSubmit(state: ThemeEditorDraftState, profiles: ThemeProfile[], onSave: Props['onSave']) {
  const [saving, setSaving] = useState(false)
  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (state.resetting) return
    setSaving(true)
    try {
      await onSave(buildThemeConfiguration({ profiles, drafts: state.drafts, assignments: state.draftAssignments, globalStyle: state.draftGlobalStyle }))
      state.setDirty(false)
    } catch (error) {
      toast(t('保存终端主题失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setSaving(false)
    }
  }
  return { saving, submit }
}

function themeConfigurationValid(drafts: Map<number, ThemeDraft>, assignments: ThemeAssignments, globalStyle: TerminalGlobalStyle) {
  const requiredIDs = configurationProfileIDs(assignments)
  const valid = requiredIDs.every((id) => {
    const draft = drafts.get(id)
    return draft !== undefined && hasValidTerminalThemeColors(draft) && hasValidTerminalStyle(draft)
  })
  return valid && hasValidGlobalStyle(globalStyle)
}

function canResetBuiltinProfiles(profiles: ThemeProfile[], assignments: ThemeAssignments) {
  const persistedIDs = [assignments.dark_profile_id, assignments.light_profile_id]
  if (!assignments.follow_interface_mode) persistedIDs.push(assignments.fixed_profile_id)
  return persistedIDs.some((id) => findProfile(profiles, id)?.definition?.is_builtin === true)
}

function ThemeStrategyCard({ assignments, busy, onFollowChange }: { assignments: ThemeAssignments; busy: boolean; onFollowChange: (checked: boolean) => void }) {
  return <Card><CardHeader><CardTitle className="text-sm">{t('终端主题应用策略')}</CardTitle></CardHeader><CardContent><Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="terminal-follow-interface-mode">{t('跟随界面模式')}</FieldLabel><FieldDescription>{t('切换 Dark/Light 时，自动使用对应的终端主题。')}</FieldDescription></FieldContent><Switch id="terminal-follow-interface-mode" checked={assignments.follow_interface_mode} disabled={busy} onCheckedChange={onFollowChange} /></Field></CardContent></Card>
}

function ThemeAssignmentCard({ profiles, assignments, busy, onSelect }: { profiles: ThemeProfile[]; assignments: ThemeAssignments; busy: boolean; onSelect: (slot: ThemeEditorSlot, id: number) => void }) {
  return <Card><CardHeader><CardTitle className="text-sm">{assignments.follow_interface_mode ? t('模式主题') : t('固定主题')}</CardTitle></CardHeader><CardContent className={assignments.follow_interface_mode ? 'grid gap-4 md:grid-cols-2' : ''}>{assignments.follow_interface_mode ? <><ThemeModeSelector mode="dark" profiles={profiles} value={assignments.dark_profile_id} disabled={busy} onValueChange={(id) => onSelect('dark', id)} /><ThemeModeSelector mode="light" profiles={profiles} value={assignments.light_profile_id} disabled={busy} onValueChange={(id) => onSelect('light', id)} /></> : <ThemeModeSelector mode="fixed" profiles={profiles} value={assignments.fixed_profile_id} disabled={busy} onValueChange={(id) => onSelect('fixed', id)} />}</CardContent></Card>
}

function ThemeWorkspace({ profile, draft, effectiveTheme, globalStyle, editorSlot, followInterfaceMode, sharedLabels, busy, onEditorSlotChange, onThemeChange, onProfileStyleChange, onAnsiChange }: { profile: ThemeProfile; draft: ThemeDraft; effectiveTheme: TerminalTheme; globalStyle: TerminalGlobalStyle; editorSlot: ThemeEditorSlot; followInterfaceMode: boolean; sharedLabels: string[]; busy: boolean; onEditorSlotChange: (slot: ThemeEditorSlot) => void; onThemeChange: <Key extends keyof TerminalTheme>(key: Key, value: TerminalTheme[Key]) => void; onProfileStyleChange: (draft: ThemeDraft) => void; onAnsiChange: (index: number, color: string) => void }) {
  return <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
    <div className="flex flex-col gap-4 lg:sticky lg:top-0"><Card><CardHeader className="flex flex-wrap items-center justify-between gap-3"><CardTitle className="flex min-w-0 flex-wrap items-center gap-2 text-sm"><SquareTerminal className="size-4 shrink-0" />{t('实时终端预览')}<span className="text-muted-foreground">· {profile.name}</span>{sharedLabels.map((label) => <Badge key={label} variant="secondary">{label}</Badge>)}</CardTitle>{followInterfaceMode && <Tabs orientation="horizontal" value={editorSlot} onValueChange={(value) => onEditorSlotChange(value as ThemeEditorSlot)}><TabsList aria-label={t('预览模式')} className="flex-row shrink-0"><TabsTrigger value="dark" className="px-3">Dark Mode</TabsTrigger><TabsTrigger value="light" className="px-3">Light Mode</TabsTrigger></TabsList></Tabs>}</CardHeader><CardContent><TerminalThemePreview theme={effectiveTheme} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">{t('ANSI 调色板')}</CardTitle></CardHeader><CardContent><AnsiPaletteEditor colors={draft.ansi} onChange={onAnsiChange} /></CardContent></Card></div>
    <div className="flex flex-col gap-4"><TerminalProfileStyleEditor draft={draft} globalStyle={globalStyle} disabled={busy} onDraftChange={onProfileStyleChange} /><TerminalThemeInspector theme={draft} onThemeChange={onThemeChange} /></div>
  </div>
}

function BuiltinThemeResetControl({ canReset, dirty, saving, resetting, includesFixed, onResettingChange, onReset }: { canReset: boolean; dirty: boolean; saving: boolean; resetting: boolean; includesFixed: boolean; onResettingChange: (resetting: boolean) => void; onReset: () => Promise<BuiltinThemeResetResult> }) {
  const [open, setOpen] = useState(false)
  const reset = async () => {
    onResettingChange(true)
    try {
      const result = await onReset()
      toast(resetResultMessage(result), 'success')
      setOpen(false)
    } catch (error) {
      toast(t('重置内置主题失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      onResettingChange(false)
    }
  }
  const disabled = !canReset || dirty || saving || resetting
  const tooltip = dirty ? t('请先保存或撤销当前主题修改') : saving ? t('正在保存主题配置') : canReset ? t('恢复当前绑定内置主题的默认样式') : t('当前绑定没有可重置的内置主题')
  return <><Tooltip><TooltipTrigger render={<span className="inline-flex shrink-0" />}><Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}><RotateCcw data-icon="inline-start" />{t('重置内置主题')}</Button></TooltipTrigger><TooltipContent>{tooltip}</TooltipContent></Tooltip><AlertDialog open={open} onOpenChange={(nextOpen) => { if (!resetting) setOpen(nextOpen) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>{t('重置内置终端主题？')}</AlertDialogTitle><AlertDialogDescription>{t('恢复当前 Dark/Light')}{includesFixed ? t('/固定') : ''} {t('内置主题的颜色和备用样式，并重新跟随全局字体与光标。全局字体与光标配置不会被修改。')}</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={resetting}>{t('取消')}</AlertDialogCancel><AlertDialogAction type="button" onClick={() => { void reset() }} disabled={resetting}>{resetting ? <><Spinner data-icon="inline-start" />{t('重置中...')}</> : t('确认重置')}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>
}

function resetResultMessage(result: BuiltinThemeResetResult): string {
  const labels = [result.dark_reset ? 'Dark' : null, result.light_reset ? 'Light' : null, result.fixed_reset ? t('固定') : null].filter((label): label is string => label !== null)
  if (labels.length === 0) return t('当前绑定没有可重置的内置主题')
  if (labels.length === 1 && labels[0] === t('固定')) return t('已重置固定内置主题')
  return t('已重置 ${} 内置主题', labels.join('、'))
}

function findProfile(profiles: ThemeProfile[], id: number) { return profiles.find((profile) => profile.id === id) }

function fixedProfileSharing(assignments: ThemeAssignments): string[] {
  const labels: string[] = []
  if (assignments.fixed_profile_id === assignments.dark_profile_id) labels.push(t('同时用于 Dark Mode'))
  if (assignments.fixed_profile_id === assignments.light_profile_id) labels.push(t('同时用于 Light Mode'))
  return labels
}

function hasValidTerminalStyle(theme: ThemeDraft): boolean {
  return validTerminalFontFamily(theme.fontFamily) && validTerminalFontSize(theme.fontSize)
}

function hasValidGlobalStyle(style: TerminalGlobalStyle): boolean {
  return validTerminalFontFamily(style.font_family) && validTerminalFontSize(style.font_size) && isHexColor(style.selection_background)
}

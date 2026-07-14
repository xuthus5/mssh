import { useEffect, useMemo, useState, type FormEvent } from 'react'
import { RotateCcw, Save, SquareTerminal } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog'
import { Spinner } from '@/components/ui/spinner'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { toast } from '@/components/ui/toast'
import { AnsiPaletteEditor } from '@/components/settings/AnsiPaletteEditor'
import { TerminalThemeInspector } from '@/components/settings/TerminalThemeInspector'
import { TerminalThemePreview } from '@/components/settings/TerminalThemePreview'
import { ThemeModeSelector } from '@/components/settings/ThemeModeSelector'
import { completeAnsiPalette, hasValidTerminalThemeColors, normalizeTerminalThemeColors } from '@/components/settings/terminalThemeValidation'
import type { TerminalTheme } from '@/hooks/useSettings'
import type { BuiltinThemeResetResult, ThemeAssignments, ThemeConfigurationInput, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

type EditorMode = 'dark' | 'light'

interface Props {
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  onSave: (configuration: ThemeConfigurationInput) => Promise<void> | void
  onResetBuiltins: () => Promise<BuiltinThemeResetResult>
}

export function ThemeEditor({ profiles, assignments, onSave, onResetBuiltins }: Props) {
  const [editorMode, setEditorMode] = useState<EditorMode>('dark')
  const [draftAssignments, setDraftAssignments] = useState(assignments)
  const [drafts, setDrafts] = useState(() => createDrafts(profiles, assignments))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  useEffect(() => { setDraftAssignments(assignments); setDrafts(createDrafts(profiles, assignments)); setDirty(false) }, [profiles, assignments])

  const selectedProfiles = useMemo(() => ({ dark: findProfile(profiles, draftAssignments.dark_profile_id), light: findProfile(profiles, draftAssignments.light_profile_id) }), [profiles, draftAssignments])
  if (!selectedProfiles.dark || !selectedProfiles.light || !drafts.dark || !drafts.light) return <p className="text-sm text-muted-foreground">终端主题配置不可用，请重新加载设置。</p>
  const activeTheme = editorMode === 'dark' ? drafts.dark : drafts.light
  const updateTheme = <Key extends keyof TerminalTheme>(key: Key, value: TerminalTheme[Key]) => { setDirty(true); setDrafts((current) => ({ ...current, [editorMode]: { ...current[editorMode], [key]: value } })) }
  const updateAnsi = (index: number, color: string) => updateTheme('ansi', activeTheme!.ansi.map((item, itemIndex) => itemIndex === index ? color : item))
  const selectProfile = (mode: EditorMode, id: number) => {
    const profile = findProfile(profiles, id)
    if (!profile) return
    setDirty(true)
    setDraftAssignments((current) => ({ ...current, [mode === 'dark' ? 'dark_profile_id' : 'light_profile_id']: id }))
    setDrafts((current) => ({ ...current, [mode]: profileToEditableTheme(profile) }))
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try { await onSave({ dark_profile: themeToProfileInput(selectedProfiles.dark!, drafts.dark!), light_profile: themeToProfileInput(selectedProfiles.light!, drafts.light!), assignments: draftAssignments }); setDirty(false) } finally { setSaving(false) }
  }
  const valid = hasValidTerminalThemeColors(drafts.dark) && hasValidTerminalThemeColors(drafts.light)
  const persistedDark = findProfile(profiles, assignments.dark_profile_id)
  const persistedLight = findProfile(profiles, assignments.light_profile_id)
  const canReset = persistedDark?.definition?.is_builtin === true || persistedLight?.definition?.is_builtin === true

  return <form onSubmit={submit} className="flex flex-col gap-5 pb-2 pt-2">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-foreground">终端主题</h2><p className="text-sm text-muted-foreground">分别配置 Dark Mode 与 Light Mode，应用模式切换时终端会自动联动。</p></div><BuiltinThemeResetControl canReset={canReset} dirty={dirty} onReset={onResetBuiltins} /></div>
    <Card><CardHeader><CardTitle className="text-sm">模式主题</CardTitle></CardHeader><CardContent className="grid gap-4 md:grid-cols-2"><ThemeModeSelector mode="dark" profiles={profiles} value={draftAssignments.dark_profile_id} onValueChange={(id) => selectProfile('dark', id)} /><ThemeModeSelector mode="light" profiles={profiles} value={draftAssignments.light_profile_id} onValueChange={(id) => selectProfile('light', id)} /></CardContent></Card>
    <Tabs value={editorMode} onValueChange={(value) => setEditorMode(value as EditorMode)}><TabsList><TabsTrigger value="dark">Dark Mode</TabsTrigger><TabsTrigger value="light">Light Mode</TabsTrigger></TabsList></Tabs>
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-0"><Card><CardHeader><CardTitle className="flex items-center gap-2 text-sm"><SquareTerminal className="size-4" />实时终端预览</CardTitle></CardHeader><CardContent><TerminalThemePreview theme={activeTheme!} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">ANSI 调色板</CardTitle></CardHeader><CardContent><AnsiPaletteEditor colors={activeTheme!.ansi} onChange={updateAnsi} /></CardContent></Card></div>
      <TerminalThemeInspector theme={activeTheme!} fontSize={String(activeTheme!.fontSize)} onThemeChange={updateTheme} onFontSizeChange={(value) => updateTheme('fontSize', parseInt(value, 10) || 14)} />
    </div>
    <div className="flex justify-end"><Button type="submit" disabled={!valid || saving}><Save data-icon="inline-start" />{saving ? '保存中...' : '保存主题配置'}</Button></div>
  </form>
}

function BuiltinThemeResetControl({ canReset, dirty, onReset }: { canReset: boolean; dirty: boolean; onReset: () => Promise<BuiltinThemeResetResult> }) {
  const [open, setOpen] = useState(false)
  const [resetting, setResetting] = useState(false)
  const reset = async () => {
    setResetting(true)
    try {
      const result = await onReset()
      toast(resetResultMessage(result), 'success')
      setOpen(false)
    } catch (error) {
      toast(`重置内置主题失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setResetting(false)
    }
  }
  const disabled = !canReset || dirty || resetting
  const tooltip = dirty ? '请先保存或撤销当前主题修改' : canReset ? '恢复当前绑定内置主题的默认样式' : '当前绑定没有可重置的内置主题'
  return <><Tooltip><TooltipTrigger render={<span className="inline-flex shrink-0" />}><Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}><RotateCcw data-icon="inline-start" />重置内置主题</Button></TooltipTrigger><TooltipContent>{tooltip}</TooltipContent></Tooltip><AlertDialog open={open} onOpenChange={(nextOpen) => { if (!resetting) setOpen(nextOpen) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>重置内置终端主题？</AlertDialogTitle><AlertDialogDescription>恢复当前 Dark/Light 内置主题的颜色、字体、字号和光标样式。自定义与导入主题不会被修改。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel><AlertDialogAction type="button" onClick={() => { void reset() }} disabled={resetting}>{resetting ? <><Spinner data-icon="inline-start" />重置中...</> : '确认重置'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>
}

function resetResultMessage(result: BuiltinThemeResetResult): string {
  if (result.dark_reset && result.light_reset) return '已重置 Dark 和 Light 内置主题'
  if (result.dark_reset) return '已重置 Dark 内置主题'
  if (result.light_reset) return '已重置 Light 内置主题'
  return '当前绑定没有可重置的内置主题'
}

function createDrafts(profiles: ThemeProfile[], assignments: ThemeAssignments) {
  const dark = findProfile(profiles, assignments.dark_profile_id)
  const light = findProfile(profiles, assignments.light_profile_id)
  return { dark: dark ? profileToEditableTheme(dark) : undefined, light: light ? profileToEditableTheme(light) : undefined }
}

function findProfile(profiles: ThemeProfile[], id: number) { return profiles.find((profile) => profile.id === id) }

function profileToEditableTheme(profile: ThemeProfile): TerminalTheme {
  const colors = JSON.parse(profile.definition?.color_payload ?? '{}') as TerminalTheme & { cursor?: string; selection?: string }
  const overrides = JSON.parse(profile.color_overrides || '{}') as Partial<TerminalTheme> & { cursor?: string }
  return normalizeTerminalThemeColors({ background: overrides.background ?? colors.background, foreground: overrides.foreground ?? colors.foreground, cursorColor: overrides.cursorColor ?? overrides.cursor ?? colors.cursor ?? colors.foreground, cursorStyle: profile.cursor_style as TerminalTheme['cursorStyle'], fontFamily: profile.font_family, fontSize: profile.font_size, ansi: completeAnsiPalette(overrides.ansi ?? colors.ansi ?? []) })
}

function themeToProfileInput(profile: ThemeProfile, theme: TerminalTheme): ThemeProfileInput {
  const normalized = normalizeTerminalThemeColors(theme)
  return { id: profile.id, name: profile.name, theme_id: profile.theme_id, font_family: normalized.fontFamily, font_size: normalized.fontSize, cursor_style: normalized.cursorStyle, color_overrides: JSON.stringify({ background: normalized.background, foreground: normalized.foreground, cursor: normalized.cursorColor, ansi: normalized.ansi }) } as ThemeProfileInput
}

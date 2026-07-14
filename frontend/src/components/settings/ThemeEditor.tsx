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
import { TerminalThemeInspector } from '@/components/settings/TerminalThemeInspector'
import { TerminalThemePreview } from '@/components/settings/TerminalThemePreview'
import { ThemeModeSelector } from '@/components/settings/ThemeModeSelector'
import { buildThemeConfiguration, createThemeDrafts, profileIDForSlot, type ThemeEditorSlot } from '@/components/settings/themeEditorState'
import { hasValidTerminalThemeColors } from '@/components/settings/terminalThemeValidation'
import type { ColorMode } from '@/lib/effectiveTerminalTheme'
import type { TerminalTheme } from '@/hooks/useSettings'
import type { BuiltinThemeResetResult, ThemeAssignments, ThemeConfigurationInput, ThemeProfile } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Props {
  profiles: ThemeProfile[]
  assignments: ThemeAssignments
  colorMode: ColorMode
  onSave: (configuration: ThemeConfigurationInput) => Promise<void> | void
  onResetBuiltins: () => Promise<BuiltinThemeResetResult>
}

export function ThemeEditor({ profiles, assignments, colorMode, onSave, onResetBuiltins }: Props) {
  const [editorSlot, setEditorSlot] = useState<ThemeEditorSlot>(assignments.follow_interface_mode ? 'dark' : 'fixed')
  const [draftAssignments, setDraftAssignments] = useState(assignments)
  const [drafts, setDrafts] = useState(() => createThemeDrafts(profiles))
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  useEffect(() => {
    setDraftAssignments(assignments)
    setDrafts(createThemeDrafts(profiles))
    setEditorSlot(assignments.follow_interface_mode ? 'dark' : 'fixed')
    setDirty(false)
  }, [profiles, assignments])

  const activeProfileID = profileIDForSlot(editorSlot, draftAssignments)
  const activeProfile = findProfile(profiles, activeProfileID)
  const activeTheme = drafts.get(activeProfileID)
  if (!activeProfile || !activeTheme) return <p className="text-sm text-muted-foreground">终端主题配置不可用，请重新加载设置。</p>
  const updateTheme = <Key extends keyof TerminalTheme>(key: Key, value: TerminalTheme[Key]) => {
    setDirty(true)
    setDrafts((current) => new Map(current).set(activeProfileID, { ...activeTheme, [key]: value }))
  }
  const updateAnsi = (index: number, color: string) => updateTheme('ansi', activeTheme!.ansi.map((item, itemIndex) => itemIndex === index ? color : item))
  const selectProfile = (slot: ThemeEditorSlot, id: number) => {
    setDirty(true)
    const key = slot === 'dark' ? 'dark_profile_id' : slot === 'light' ? 'light_profile_id' : 'fixed_profile_id'
    setDraftAssignments((current) => ({ ...current, [key]: id }))
    setEditorSlot(slot)
  }
  const setFollowInterfaceMode = (checked: boolean) => {
    setDirty(true)
    setDraftAssignments((current) => ({
      ...current,
      follow_interface_mode: checked,
      fixed_profile_id: current.fixed_profile_id || (colorMode === 'dark' ? current.dark_profile_id : current.light_profile_id),
    }))
    setEditorSlot(checked ? colorMode : 'fixed')
  }
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setSaving(true)
    try {
      await onSave(buildThemeConfiguration(profiles, drafts, draftAssignments))
      setDirty(false)
    } catch (error) {
      toast(`保存终端主题失败: ${error instanceof Error ? error.message : String(error)}`, 'error')
    } finally {
      setSaving(false)
    }
  }
  const requiredIDs = [draftAssignments.dark_profile_id, draftAssignments.light_profile_id]
  if (!draftAssignments.follow_interface_mode) requiredIDs.push(draftAssignments.fixed_profile_id)
  const valid = requiredIDs.every((id) => {
    const draft = drafts.get(id)
    return draft !== undefined && hasValidTerminalThemeColors(draft)
  })
  const persistedIDs = [assignments.dark_profile_id, assignments.light_profile_id]
  if (!assignments.follow_interface_mode) persistedIDs.push(assignments.fixed_profile_id)
  const canReset = persistedIDs.some((id) => findProfile(profiles, id)?.definition?.is_builtin === true)
  const mismatch = !draftAssignments.follow_interface_mode && activeProfile.definition?.mode !== 'universal' && activeProfile.definition?.mode !== colorMode
  const sharedLabels = !draftAssignments.follow_interface_mode ? fixedProfileSharing(draftAssignments) : []

  return <form onSubmit={submit} className="flex flex-col gap-5 pb-2 pt-2">
    <div className="flex items-start justify-between gap-4"><div><h2 className="text-lg font-semibold text-foreground">终端主题</h2><p className="text-sm text-muted-foreground">选择终端是否跟随应用模式，或固定使用一个独立主题。</p></div><BuiltinThemeResetControl canReset={canReset} dirty={dirty} includesFixed={!assignments.follow_interface_mode} onReset={onResetBuiltins} /></div>
    <Card><CardHeader><CardTitle className="text-sm">终端主题应用策略</CardTitle></CardHeader><CardContent><Field orientation="horizontal"><FieldContent><FieldLabel htmlFor="terminal-follow-interface-mode">跟随界面模式</FieldLabel><FieldDescription>切换 Dark/Light 时，自动使用对应的终端主题。</FieldDescription></FieldContent><Switch id="terminal-follow-interface-mode" checked={draftAssignments.follow_interface_mode} disabled={saving} onCheckedChange={setFollowInterfaceMode} /></Field></CardContent></Card>
    <Card><CardHeader><CardTitle className="text-sm">{draftAssignments.follow_interface_mode ? '模式主题' : '固定主题'}</CardTitle></CardHeader><CardContent className={draftAssignments.follow_interface_mode ? 'grid gap-4 md:grid-cols-2' : ''}>{draftAssignments.follow_interface_mode ? <><ThemeModeSelector mode="dark" profiles={profiles} value={draftAssignments.dark_profile_id} disabled={saving} onValueChange={(id) => selectProfile('dark', id)} /><ThemeModeSelector mode="light" profiles={profiles} value={draftAssignments.light_profile_id} disabled={saving} onValueChange={(id) => selectProfile('light', id)} /></> : <ThemeModeSelector mode="fixed" profiles={profiles} value={draftAssignments.fixed_profile_id} disabled={saving} onValueChange={(id) => selectProfile('fixed', id)} />}</CardContent></Card>
    {draftAssignments.follow_interface_mode && <Tabs value={editorSlot} onValueChange={(value) => setEditorSlot(value as ThemeEditorSlot)}><TabsList><TabsTrigger value="dark">Dark Mode</TabsTrigger><TabsTrigger value="light">Light Mode</TabsTrigger></TabsList></Tabs>}
    {mismatch && <Alert><AlertDescription>该终端主题为 {activeProfile.definition?.mode === 'dark' ? 'Dark' : 'Light'} 类型，当前界面为 {colorMode === 'dark' ? 'Dark' : 'Light'} Mode。终端颜色将保持固定，不受界面模式影响。</AlertDescription></Alert>}
    <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.2fr)_minmax(18rem,0.8fr)]">
      <div className="flex flex-col gap-4 lg:sticky lg:top-0"><Card><CardHeader><CardTitle className="flex flex-wrap items-center gap-2 text-sm"><SquareTerminal className="size-4" />实时终端预览<span className="text-muted-foreground">· {activeProfile.name}</span>{sharedLabels.map((label) => <Badge key={label} variant="secondary">{label}</Badge>)}</CardTitle></CardHeader><CardContent><TerminalThemePreview theme={activeTheme} /></CardContent></Card><Card><CardHeader><CardTitle className="text-sm">ANSI 调色板</CardTitle></CardHeader><CardContent><AnsiPaletteEditor colors={activeTheme.ansi} onChange={updateAnsi} /></CardContent></Card></div>
      <TerminalThemeInspector theme={activeTheme} fontSize={String(activeTheme.fontSize)} onThemeChange={updateTheme} onFontSizeChange={(value) => updateTheme('fontSize', parseInt(value, 10) || 14)} />
    </div>
    <div className="flex justify-end"><Button type="submit" disabled={!valid || saving}><Save data-icon="inline-start" />{saving ? '保存中...' : '保存主题配置'}</Button></div>
  </form>
}

function BuiltinThemeResetControl({ canReset, dirty, includesFixed, onReset }: { canReset: boolean; dirty: boolean; includesFixed: boolean; onReset: () => Promise<BuiltinThemeResetResult> }) {
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
  return <><Tooltip><TooltipTrigger render={<span className="inline-flex shrink-0" />}><Button type="button" variant="outline" disabled={disabled} onClick={() => setOpen(true)}><RotateCcw data-icon="inline-start" />重置内置主题</Button></TooltipTrigger><TooltipContent>{tooltip}</TooltipContent></Tooltip><AlertDialog open={open} onOpenChange={(nextOpen) => { if (!resetting) setOpen(nextOpen) }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>重置内置终端主题？</AlertDialogTitle><AlertDialogDescription>恢复当前 Dark/Light{includesFixed ? '/固定' : ''} 内置主题的颜色、字体、字号和光标样式。自定义与导入主题不会被修改。</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel disabled={resetting}>取消</AlertDialogCancel><AlertDialogAction type="button" onClick={() => { void reset() }} disabled={resetting}>{resetting ? <><Spinner data-icon="inline-start" />重置中...</> : '确认重置'}</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog></>
}

function resetResultMessage(result: BuiltinThemeResetResult): string {
  const labels = [result.dark_reset ? 'Dark' : null, result.light_reset ? 'Light' : null, result.fixed_reset ? '固定' : null].filter((label): label is string => label !== null)
  if (labels.length === 0) return '当前绑定没有可重置的内置主题'
  if (labels.length === 1 && labels[0] === '固定') return '已重置固定内置主题'
  return `已重置 ${labels.join('、')} 内置主题`
}

function findProfile(profiles: ThemeProfile[], id: number) { return profiles.find((profile) => profile.id === id) }

function fixedProfileSharing(assignments: ThemeAssignments): string[] {
  const labels: string[] = []
  if (assignments.fixed_profile_id === assignments.dark_profile_id) labels.push('同时用于 Dark Mode')
  if (assignments.fixed_profile_id === assignments.light_profile_id) labels.push('同时用于 Light Mode')
  return labels
}

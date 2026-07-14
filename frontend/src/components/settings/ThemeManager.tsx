import { useMemo, useState } from 'react'
import { Copy, Download, Trash2 } from 'lucide-react'
import { Dialogs } from '@wailsio/runtime'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ThemeImportResults } from '@/components/settings/ThemeImportResults'
import { toast } from '@/components/ui/toast'
import type { ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface Props {
  profiles: ThemeProfile[]
  onImport: (paths: string[]) => Promise<ThemeImportSummary>
  onDeleteProfile: (id: number) => Promise<void> | void
  onDeleteDefinition: (id: number) => Promise<void> | void
  onCreateProfile: (input: ThemeProfileInput) => Promise<unknown> | unknown
  onUpdateProfile: (input: ThemeProfileInput) => Promise<void> | void
}

export function ThemeManager({ profiles, onImport, onDeleteProfile, onDeleteDefinition, onCreateProfile, onUpdateProfile }: Props) {
  const [query, setQuery] = useState('')
  const [summary, setSummary] = useState<ThemeImportSummary | null>(null)
  const filtered = useMemo(() => profiles.filter((profile) => profile.name.toLowerCase().includes(query.toLowerCase())), [profiles, query])
  const importFiles = async () => {
    const selected = await Dialogs.OpenFile({ Title: '导入 iTerm2 终端主题', CanChooseFiles: true, CanChooseDirectories: false, AllowsMultipleSelection: true, Filters: [{ DisplayName: 'iTerm2 Color Schemes', Pattern: '*.itermcolors' }] })
    const paths = typeof selected === 'string' ? [selected] : selected
    if (paths.length > 0) {
      try { setSummary(await onImport(paths)) } catch (error) { toast(`导入主题失败: ${error instanceof Error ? error.message : String(error)}`, 'error') }
    }
  }
  return <Card>
    <CardHeader><CardTitle className="flex items-center justify-between gap-3 text-sm"><span>主题管理</span><Button type="button" size="sm" variant="outline" onClick={() => { void importFiles() }}><Download data-icon="inline-start" />导入 iTerm2 主题</Button></CardTitle></CardHeader>
    <CardContent className="flex flex-col gap-4">
      <Input aria-label="搜索终端主题" placeholder="搜索名称或来源" value={query} onChange={(event) => setQuery(event.target.value)} />
      {summary && <ThemeImportResults summary={summary} />}
      <Table><TableHeader><TableRow><TableHead>名称</TableHead><TableHead>模式</TableHead><TableHead>来源</TableHead><TableHead>许可证</TableHead><TableHead className="text-right">操作</TableHead></TableRow></TableHeader><TableBody>
        {filtered.map((profile) => <ThemeRow key={profile.id} profile={profile} onDeleteProfile={onDeleteProfile} onDeleteDefinition={onDeleteDefinition} onCreateProfile={onCreateProfile} onUpdateProfile={onUpdateProfile} />)}
      </TableBody></Table>
    </CardContent>
  </Card>
}

function ThemeRow({ profile, onDeleteProfile, onDeleteDefinition, onCreateProfile, onUpdateProfile }: Omit<Props, 'profiles' | 'onImport'> & { profile: ThemeProfile }) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const input = (): ThemeProfileInput => ({ id: profile.id, name, theme_id: profile.theme_id, follow_global_style: profile.follow_global_style, font_family: profile.font_family, font_size: profile.font_size, cursor_style: profile.cursor_style, color_overrides: profile.color_overrides } as ThemeProfileInput)
  return <TableRow><TableCell>{editing ? <Input aria-label={`重命名 ${profile.name}`} value={name} onChange={(event) => setName(event.target.value)} /> : profile.name}</TableCell><TableCell><Badge variant="outline">{profile.definition?.mode}</Badge></TableCell><TableCell>{profile.definition?.source_type}</TableCell><TableCell>{profile.definition?.source_license || '未知'}</TableCell><TableCell><div className="flex justify-end gap-1">
    {editing ? <Button type="button" size="xs" onClick={() => { void runAction(() => onUpdateProfile(input()), () => setEditing(false)) }}>保存名称</Button> : <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(true)}>重命名</Button>}
    <Button type="button" size="icon-xs" variant="ghost" aria-label={`复制 ${profile.name}`} onClick={() => { void runAction(() => onCreateProfile({ ...input(), id: 0, name: `${profile.name} 副本` } as ThemeProfileInput)) }}><Copy /></Button>
    <Button type="button" size="icon-xs" variant="ghost" aria-label={`删除 ${profile.name} Profile`} onClick={() => { if (window.confirm(`确认删除 ${profile.name} Profile？`)) void runAction(() => onDeleteProfile(profile.id)) }}><Trash2 /></Button>
    <Button type="button" size="icon-xs" variant="destructive" aria-label={`删除 ${profile.name} 主题定义`} disabled={profile.definition?.is_builtin} onClick={() => { if (profile.definition && window.confirm(`确认删除 ${profile.name} 主题定义？`)) void runAction(() => onDeleteDefinition(profile.definition!.id)) }}><Trash2 /></Button>
  </div></TableCell></TableRow>
}

async function runAction(action: () => Promise<unknown> | unknown, onSuccess?: () => void) {
  try { await action(); onSuccess?.() } catch (error) { toast(`主题操作失败: ${error instanceof Error ? error.message : String(error)}`, 'error') }
}

import { useMemo, useState } from 'react'
import { Copy, Download, Trash2 } from 'lucide-react'
import { Dialogs } from '@wailsio/runtime'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { ThemeImportResults } from '@/components/settings/ThemeImportResults'
import { toast } from '@/components/ui/toast'
import type { ThemeImportSummary, ThemeProfile, ThemeProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { t } from '@/i18n'

interface Props {
  profiles: ThemeProfile[]
  onImport: (paths: string[]) => Promise<ThemeImportSummary>
  onDeleteProfile: (id: number) => Promise<void> | void
  onDeleteDefinition: (id: number) => Promise<void> | void
  onCreateProfile: (input: ThemeProfileInput) => Promise<unknown> | unknown
  onUpdateProfile: (input: ThemeProfileInput) => Promise<void> | void
}

type DeleteTarget = ThemeProfile | null

export function ThemeManager({ profiles, onImport, onDeleteProfile, onDeleteDefinition, onCreateProfile, onUpdateProfile }: Props) {
  const [query, setQuery] = useState('')
  const [summary, setSummary] = useState<ThemeImportSummary | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget>(null)
  const [deleting, setDeleting] = useState(false)
  const filtered = useMemo(
    () => profiles.filter((profile) => profile.name.toLowerCase().includes(query.toLowerCase())),
    [profiles, query],
  )

  const importFiles = async () => {
    let paths: string[] = []
    try {
      const selected = await Dialogs.OpenFile({
        Title: t('导入 iTerm2 终端主题'),
        CanChooseFiles: true,
        CanChooseDirectories: false,
        AllowsMultipleSelection: true,
        Filters: [{ DisplayName: 'iTerm2 Color Schemes', Pattern: '*.itermcolors' }],
      })
      paths = typeof selected === 'string' ? [selected] : selected ?? []
    } catch (error) {
      toast(t('选择主题文件失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
      return
    }
    if (paths.length === 0) return
    try {
      setSummary(await onImport(paths))
    } catch (error) {
      toast(t('导入主题失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    }
  }

  const confirmDelete = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await onDeleteProfile(deleteTarget.id)
      await maybeDeleteOrphanDefinition(deleteTarget, onDeleteDefinition)
      setDeleteTarget(null)
    } catch (error) {
      toast(t('主题操作失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    } finally {
      setDeleting(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between gap-3 text-sm">
          <span>{t('主题管理')}</span>
          <Button type="button" size="sm" variant="outline" onClick={() => { void importFiles() }}>
            <Download data-icon="inline-start" />
            {t('导入 iTerm2 主题')}
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <Input
          aria-label={t('搜索终端主题')}
          placeholder={t('搜索名称或来源')}
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        {summary && <ThemeImportResults summary={summary} />}
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('名称')}</TableHead>
              <TableHead>{t('模式')}</TableHead>
              <TableHead>{t('来源')}</TableHead>
              <TableHead>{t('许可证')}</TableHead>
              <TableHead className="text-right">{t('操作')}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.map((profile) => (
              <ThemeRow
                key={profile.id}
                profile={profile}
                onCreateProfile={onCreateProfile}
                onUpdateProfile={onUpdateProfile}
                onRequestDelete={setDeleteTarget}
              />
            ))}
          </TableBody>
        </Table>
      </CardContent>
      <ThemeDeleteDialog
        target={deleteTarget}
        pending={deleting}
        onOpenChange={(open) => {
          if (!open && !deleting) setDeleteTarget(null)
        }}
        onConfirm={() => { void confirmDelete() }}
      />
    </Card>
  )
}

function ThemeRow({
  profile,
  onCreateProfile,
  onUpdateProfile,
  onRequestDelete,
}: {
  profile: ThemeProfile
  onCreateProfile: Props['onCreateProfile']
  onUpdateProfile: Props['onUpdateProfile']
  onRequestDelete: (profile: ThemeProfile) => void
}) {
  const [editing, setEditing] = useState(false)
  const [name, setName] = useState(profile.name)
  const input = (): ThemeProfileInput => ({
    id: profile.id,
    name,
    theme_id: profile.theme_id,
    follow_global_style: profile.follow_global_style,
    font_family: profile.font_family,
    font_size: profile.font_size,
    cursor_style: profile.cursor_style,
    color_overrides: profile.color_overrides,
  } as ThemeProfileInput)

  return (
    <TableRow>
      <TableCell>
        {editing ? (
          <Input
            aria-label={t('重命名 ${}', profile.name)}
            value={name}
            onChange={(event) => setName(event.target.value)}
          />
        ) : (
          profile.name
        )}
      </TableCell>
      <TableCell>
        <Badge variant="outline">{profile.definition?.mode}</Badge>
      </TableCell>
      <TableCell>{profile.definition?.source_type}</TableCell>
      <TableCell>{profile.definition?.source_license || t('未知')}</TableCell>
      <TableCell>
        <div className="flex justify-end gap-1">
          {editing ? (
            <Button
              type="button"
              size="xs"
              onClick={() => {
                void runAction(() => onUpdateProfile(input()), () => setEditing(false))
              }}
            >
              {t('保存名称')}
            </Button>
          ) : (
            <Button type="button" size="xs" variant="ghost" onClick={() => setEditing(true)}>
              {t('重命名')}
            </Button>
          )}
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t('复制 ${}', profile.name)}
            onClick={() => {
              void runAction(() => onCreateProfile({
                ...input(),
                id: 0,
                name: t('${} 副本', profile.name),
              } as ThemeProfileInput))
            }}
          >
            <Copy />
          </Button>
          <Button
            type="button"
            size="icon-xs"
            variant="ghost"
            aria-label={t('删除 ${}', profile.name)}
            onClick={() => onRequestDelete(profile)}
          >
            <Trash2 />
          </Button>
        </div>
      </TableCell>
    </TableRow>
  )
}

function ThemeDeleteDialog({
  target,
  pending,
  onOpenChange,
  onConfirm,
}: {
  target: DeleteTarget
  pending: boolean
  onOpenChange: (open: boolean) => void
  onConfirm: () => void
}) {
  const builtin = Boolean(target?.definition?.is_builtin)
  return (
    <AlertDialog open={target !== null} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t('删除主题「${}」？', target?.name ?? '')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {builtin
              ? t('将移除该主题配置（Profile）。内置颜色定义会保留，不会被删除。')
              : t('将移除该主题配置（Profile）。若自定义颜色定义不再被引用，也会一并清理。此操作不可撤销。')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={pending}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction
            type="button"
            variant="destructive"
            disabled={pending}
            onClick={onConfirm}
          >
            {pending ? t('删除中…') : t('确认删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}

async function maybeDeleteOrphanDefinition(
  profile: ThemeProfile,
  onDeleteDefinition: Props['onDeleteDefinition'],
) {
  if (!profile.definition || profile.definition.is_builtin) return
  try {
    await onDeleteDefinition(profile.definition.id)
  } catch {
    // 仍被其他 Profile 引用时后端会拒绝，保留定义即可。
  }
}

async function runAction(action: () => Promise<unknown> | unknown, onSuccess?: () => void) {
  try {
    await action()
    onSuccess?.()
  } catch (error) {
    toast(t('主题操作失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
  }
}

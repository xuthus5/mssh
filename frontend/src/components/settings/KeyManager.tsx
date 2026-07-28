import { useState } from 'react'
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
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { KeyGenerateDialog, KeyImportDialog, KeyMaterialDialog, type KeyMaterialMode } from '@/components/settings/KeyDialogs'
import type { KeyInfo } from '@/hooks/useSettings'
import { useKeyManagerRuntime, type KeyManagerProps, type KeyManagerRuntime } from '@/components/settings/keyManagerRuntime'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { t } from '@/i18n'

function typeLabel(type: KeyInfo['type']) {
  return ({ rsa: 'RSA', ed25519: 'Ed25519', ecdsa: 'ECDSA' })[type]
}

function keyTypeText(key: KeyInfo) {
  const bits = key.bits > 0 ? ` (${key.bits})` : ''
  return `${typeLabel(key.type)}${bits}`
}

export function KeyManager(props: KeyManagerProps) {
  const [generateOpen, setGenerateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const model = useKeyManagerRuntime(props)
  useSettingsWindowHide(() => {
    setGenerateOpen(false)
    setImportOpen(false)
    model.dismissTransientState()
  })
  return <div className="flex flex-col gap-3 pt-2">
    <KeyToolbar onGenerate={() => setGenerateOpen(true)} onImport={() => setImportOpen(true)} />
    {model.rowActionError ? <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">{model.rowActionError}</div> : null}
    <KeyTable props={props} model={model} />
    <KeyDialogs props={props} model={model} generateOpen={generateOpen} importOpen={importOpen} setGenerateOpen={setGenerateOpen} setImportOpen={setImportOpen} />
    <KeyDeleteDialog model={model} />
  </div>
}

function KeyToolbar({ onGenerate, onImport }: { onGenerate: () => void; onImport: () => void }) {
  return <div className="flex items-center gap-2"><Button size="sm" variant="outline" onClick={onGenerate}>{t('生成')}</Button><Button size="sm" variant="outline" onClick={onImport}>{t('导入')}</Button></div>
}

function KeyTable({ props, model }: { props: KeyManagerProps; model: KeyManagerRuntime }) {
  return <Table><TableHeader><TableRow><TableHead>{t('名称')}</TableHead><TableHead>{t('类型')}</TableHead><TableHead>{t('创建时间')}</TableHead><TableHead className="text-right">{t('操作')}</TableHead></TableRow></TableHeader><TableBody><KeyTableContent props={props} model={model} /></TableBody></Table>
}

function KeyTableContent({ props, model }: { props: KeyManagerProps; model: KeyManagerRuntime }) {
  if (props.loadError) return <TableRow><TableCell colSpan={4} className="text-center"><div className="flex flex-col items-center gap-2 py-2 text-sm text-destructive" role="alert"><span>{t('加载密钥列表失败: ${}', props.loadError)}</span>{props.onReload ? <Button size="xs" variant="outline" disabled={props.loading} onClick={() => { void Promise.resolve(props.onReload?.()).catch(() => undefined) }}>{t('重试')}</Button> : null}</div></TableCell></TableRow>
  if (props.loading && props.keys.length === 0) return <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t('正在加载密钥...')}</TableCell></TableRow>
  if (props.keys.length === 0) return <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t('无密钥')}</TableCell></TableRow>
  return <>{props.keys.map((key) => <KeyRow key={key.id} item={key} model={model} />)}</>
}

function KeyRow({ item, model }: { item: KeyInfo; model: KeyManagerRuntime }) {
  const open = (mode: KeyMaterialMode) => { void model.openMaterial(item.id, mode).catch(() => undefined) }
  const pending = model.pendingRows.has(item.id)
  return <TableRow aria-busy={pending}>
    <TableCell>{item.name}</TableCell><TableCell>{keyTypeText(item)}</TableCell><TableCell className="text-xs">{item.createdAt}</TableCell>
    <TableCell className="text-right"><div className="flex justify-end gap-1">
      <Button size="xs" variant="ghost" aria-label={t('查看 ${}', item.name)} disabled={pending} onClick={() => open('view')}>{t('查看')}</Button>
      <Button size="xs" variant="ghost" aria-label={t('编辑 ${}', item.name)} disabled={pending} onClick={() => open('edit')}>{t('编辑')}</Button>
      <Button size="xs" variant="ghost" aria-label={t('复制 ${} 公钥', item.name)} disabled={pending} onClick={() => { void model.copyPublicKey(item.id).catch(() => undefined) }}>{t('复制公钥')}</Button>
      <Button size="xs" variant="ghost" className="text-destructive" aria-label={t('删除 ${}', item.name)} disabled={pending} onClick={() => { void model.requestDelete(item).catch(() => undefined) }}>{t('删除')}</Button>
    </div></TableCell>
  </TableRow>
}

function KeyDialogs({ props, model, generateOpen, importOpen, setGenerateOpen, setImportOpen }: { props: KeyManagerProps; model: KeyManagerRuntime; generateOpen: boolean; importOpen: boolean; setGenerateOpen: (open: boolean) => void; setImportOpen: (open: boolean) => void }) {
  return <><KeyGenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} onGenerate={props.onGenerate} onGenerated={(material) => model.setMaterialState({ mode: 'generated', material })} /><KeyImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={props.onImport} onSelectFile={props.onSelectImportFile} /><KeyMaterialDialog state={model.materialState} onOpenChange={(open) => { if (!open) model.setMaterialState(null) }} onUpdate={props.onUpdate} /></>
}

function KeyDeleteDialog({ model }: { model: KeyManagerRuntime }) {
  return <AlertDialog open={model.deleteTarget !== null} onOpenChange={model.handleOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {model.deleteTarget && model.deleteTarget.usage > 0
              ? t('该密钥被 ${} 个会话引用，删除后这些会话将无法使用密钥认证。仍要删除吗？', model.deleteTarget.usage)
              : t('删除密钥“${}”？', model.deleteTarget?.key.name ?? '')}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('此操作不可撤销。')}</AlertDialogDescription>
        </AlertDialogHeader>
        {model.deleteError ? (
          <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
            {model.deleteError}
          </div>
        ) : null}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={model.deleting}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={model.deleting} onClick={() => { void model.confirmDelete().catch(() => undefined) }}>
            {model.deleting ? t('删除中…') : t('确认删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
}

import { useRef, useState } from 'react'
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
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import { KeyGenerateDialog, KeyImportDialog, KeyMaterialDialog, type KeyMaterialMode } from '@/components/settings/KeyDialogs'
import type { KeyImportFile, KeyInfo, KeyMaterial } from '@/hooks/useSettings'
import { KeyService } from '@/lib/wails'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'


interface Props {
  keys: KeyInfo[]
  loadError?: string
  loading?: boolean
  onReload?: () => void | Promise<void>
  onGenerate: (name: string, type: KeyInfo['type'], bits: number) => Promise<KeyMaterial | undefined>
  onImport: (name: string, privateKey: string) => Promise<KeyInfo | undefined>
  onDelete: (id: string) => void | Promise<void>
  onExport: (id: string) => Promise<string | undefined>
  onLoadMaterial: (id: string) => Promise<KeyMaterial | undefined>
  onUpdate: (material: KeyMaterial) => Promise<KeyMaterial | undefined>
  onSelectImportFile: () => Promise<KeyImportFile | undefined>
}

interface MaterialState {
  mode: KeyMaterialMode
  material: KeyMaterial
}

function typeLabel(type: KeyInfo['type']) {
  return ({ rsa: 'RSA', ed25519: 'Ed25519', ecdsa: 'ECDSA' })[type]
}

function keyTypeText(key: KeyInfo) {
  const bits = key.bits > 0 ? ` (${key.bits})` : ''
  return `${typeLabel(key.type)}${bits}`
}

export function KeyManager(props: Props) {
  const [generateOpen, setGenerateOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [materialState, setMaterialState] = useState<MaterialState | null>(null)
  const [loadingID, setLoadingID] = useState<string | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<{ key: KeyInfo; usage: number } | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [rowActionError, setRowActionError] = useState('')
  const materialRequest = useRef(0)

  const openMaterial = async (id: string, mode: KeyMaterialMode) => {
    const request = ++materialRequest.current
    setLoadingID(id)
    setRowActionError('')
    try {
      const material = await props.onLoadMaterial(id)
      if (request !== materialRequest.current) return
      if (material) {
        setMaterialState({ mode, material })
        return
      }
      setRowActionError(t('读取密钥失败: ${}', t('密钥不存在或无法读取')))
    } catch (error) {
      if (request !== materialRequest.current) return
      setRowActionError(t('读取密钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (request === materialRequest.current) setLoadingID(null)
    }
  }
  const copyPublicKey = async (id: string) => {
    setRowActionError('')
    const publicKey = await props.onExport(id)
    if (!publicKey) {
      setRowActionError(t('读取密钥失败: ${}', t('密钥不存在或无法读取')))
      return
    }
    try {
      await getClipboard().writeText(publicKey)
      toast(t('公钥已复制'), 'success')
    } catch (error) {
      setRowActionError(t('复制公钥失败: ${}', error instanceof Error ? error.message : String(error)))
    }
  }
  const deleteKey = async (key: KeyInfo) => {
    setRowActionError('')
    try {
      const usage = await KeyService.UsageCount(Number(key.id))
      setDeleteTarget({ key, usage })
    } catch (error) {
      setRowActionError(t('分析密钥影响失败: ${}', error instanceof Error ? error.message : String(error)))
    }
  }

  const confirmDeleteKey = async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await props.onDelete(deleteTarget.key.id)
      setDeleteTarget(null)
    } catch (error) {
      // onDelete surfaces toast; keep dialog open for retry
      logger.error('delete key confirmation failed', error)
    } finally {
      setDeleting(false)
    }
  }

  return <div className="flex flex-col gap-3 pt-2">
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>{t('生成')}</Button>
      <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>{t('导入')}</Button>
    </div>
    {rowActionError ? (
      <div className="rounded-xl border border-destructive/40 bg-destructive/10 p-3 text-sm text-destructive" role="alert">
        {rowActionError}
      </div>
    ) : null}
    <Table>
      <TableHeader><TableRow><TableHead>{t('名称')}</TableHead><TableHead>{t('类型')}</TableHead><TableHead>{t('创建时间')}</TableHead><TableHead className="text-right">{t('操作')}</TableHead></TableRow></TableHeader>
      <TableBody>
        {props.loadError ? (
          <TableRow>
            <TableCell colSpan={4} className="text-center">
              <div className="flex flex-col items-center gap-2 py-2 text-sm text-destructive" role="alert">
                <span>{t('加载密钥列表失败: ${}', props.loadError)}</span>
                {props.onReload ? (
                  <Button size="xs" variant="outline" disabled={props.loading} onClick={() => { void Promise.resolve(props.onReload?.()).catch(() => undefined) }}>{t('重试')}</Button>
                ) : null}
              </div>
            </TableCell>
          </TableRow>
        ) : props.loading && props.keys.length === 0 ? (
          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t('正在加载密钥...')}</TableCell></TableRow>
        ) : props.keys.length === 0 ? (
          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t('无密钥')}</TableCell></TableRow>
        ) : props.keys.map((key) => <TableRow key={key.id}>
          <TableCell>{key.name}</TableCell><TableCell>{keyTypeText(key)}</TableCell><TableCell className="text-xs">{key.createdAt}</TableCell>
          <TableCell className="text-right"><div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" aria-label={t('查看 ${}', key.name)} disabled={loadingID === key.id} onClick={() => { void openMaterial(key.id, 'view').catch(() => undefined) }}>{t('查看')}</Button>
            <Button size="xs" variant="ghost" aria-label={t('编辑 ${}', key.name)} disabled={loadingID === key.id} onClick={() => { void openMaterial(key.id, 'edit').catch(() => undefined) }}>{t('编辑')}</Button>
            <Button size="xs" variant="ghost" aria-label={t('复制 ${} 公钥', key.name)} onClick={() => { void copyPublicKey(key.id).catch(() => undefined) }}>{t('复制公钥')}</Button>
            <Button size="xs" variant="ghost" className="text-destructive" aria-label={t('删除 ${}', key.name)} onClick={() => { void deleteKey(key).catch(() => undefined) }}>{t('删除')}</Button>
          </div></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
    <KeyGenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} onGenerate={props.onGenerate}
      onGenerated={(material) => setMaterialState({ mode: 'generated', material })} />
    <KeyImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={props.onImport} onSelectFile={props.onSelectImportFile} />
    <KeyMaterialDialog state={materialState} onOpenChange={(open) => { if (!open) setMaterialState(null) }} onUpdate={props.onUpdate} />
    <AlertDialog open={deleteTarget !== null} onOpenChange={(open) => { if (!open && !deleting) setDeleteTarget(null) }}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {deleteTarget && deleteTarget.usage > 0
              ? t('该密钥被 ${} 个会话引用，删除后这些会话将无法使用密钥认证。仍要删除吗？', deleteTarget.usage)
              : t('删除密钥“${}”？', deleteTarget?.key.name ?? '')}
          </AlertDialogTitle>
          <AlertDialogDescription>{t('此操作不可撤销。')}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={deleting}>{t('取消')}</AlertDialogCancel>
          <AlertDialogAction type="button" variant="destructive" disabled={deleting} onClick={() => { void confirmDeleteKey().catch(() => undefined) }}>
            {deleting ? t('删除中…') : t('确认删除')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  </div>
}


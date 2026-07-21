import { useRef, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { toast } from '@/components/ui/toast'
import { getClipboard } from '@/lib/clipboard'
import { KeyGenerateDialog, KeyImportDialog, KeyMaterialDialog, type KeyMaterialMode } from '@/components/settings/KeyDialogs'
import type { KeyImportFile, KeyInfo, KeyMaterial } from '@/hooks/useSettings'
import { KeyService } from '@/lib/wails'
import { t } from '@/i18n'


interface Props {
  keys: KeyInfo[]
  onGenerate: (name: string, type: KeyInfo['type'], bits: number) => Promise<KeyMaterial | undefined>
  onImport: (name: string, privateKey: string) => Promise<KeyInfo | undefined>
  onDelete: (id: string) => void
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
  const materialRequest = useRef(0)

  const openMaterial = async (id: string, mode: KeyMaterialMode) => {
    const request = ++materialRequest.current
    setLoadingID(id)
    try {
      const material = await props.onLoadMaterial(id)
      if (material && request === materialRequest.current) setMaterialState({ mode, material })
    } finally {
      if (request === materialRequest.current) setLoadingID(null)
    }
  }
  const copyPublicKey = async (id: string) => {
    const publicKey = await props.onExport(id)
    if (!publicKey) return
    try {
      await getClipboard().writeText(publicKey)
      toast(t('公钥已复制'), 'success')
    } catch (error) {
      toast(t('复制公钥失败: ${}', error instanceof Error ? error.message : String(error)), 'error')
    }
  }
  const deleteKey = async (key: KeyInfo) => {
    try {
      const usage = await KeyService.UsageCount(Number(key.id))
      if (!window.confirm(usage > 0 ? t('该密钥被 ${} 个会话引用，删除后这些会话将无法使用密钥认证。仍要删除吗？', usage) : t('删除密钥“${}”？', key.name))) return
      props.onDelete(key.id)
    } catch (error) { toast(t('分析密钥影响失败: ${}', error instanceof Error ? error.message : String(error)), 'error') }
  }

  return <div className="flex flex-col gap-3 pt-2">
    <div className="flex items-center gap-2">
      <Button size="sm" variant="outline" onClick={() => setGenerateOpen(true)}>{t('生成')}</Button>
      <Button size="sm" variant="outline" onClick={() => setImportOpen(true)}>{t('导入')}</Button>
    </div>
    <Table>
      <TableHeader><TableRow><TableHead>{t('名称')}</TableHead><TableHead>{t('类型')}</TableHead><TableHead>{t('创建时间')}</TableHead><TableHead className="text-right">{t('操作')}</TableHead></TableRow></TableHeader>
      <TableBody>
        {props.keys.length === 0 ? <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">{t('无密钥')}</TableCell></TableRow> : props.keys.map((key) => <TableRow key={key.id}>
          <TableCell>{key.name}</TableCell><TableCell>{keyTypeText(key)}</TableCell><TableCell className="text-xs">{key.createdAt}</TableCell>
          <TableCell className="text-right"><div className="flex justify-end gap-1">
            <Button size="xs" variant="ghost" aria-label={t('查看 ${}', key.name)} disabled={loadingID === key.id} onClick={() => { void openMaterial(key.id, 'view') }}>{t('查看')}</Button>
            <Button size="xs" variant="ghost" aria-label={t('编辑 ${}', key.name)} disabled={loadingID === key.id} onClick={() => { void openMaterial(key.id, 'edit') }}>{t('编辑')}</Button>
            <Button size="xs" variant="ghost" aria-label={t('复制 ${} 公钥', key.name)} onClick={() => { void copyPublicKey(key.id) }}>{t('复制公钥')}</Button>
            <Button size="xs" variant="ghost" className="text-destructive" aria-label={t('删除 ${}', key.name)} onClick={() => { void deleteKey(key) }}>{t('删除')}</Button>
          </div></TableCell>
        </TableRow>)}
      </TableBody>
    </Table>
    <KeyGenerateDialog open={generateOpen} onOpenChange={setGenerateOpen} onGenerate={props.onGenerate}
      onGenerated={(material) => setMaterialState({ mode: 'generated', material })} />
    <KeyImportDialog open={importOpen} onOpenChange={setImportOpen} onImport={props.onImport} onSelectFile={props.onSelectImportFile} />
    <KeyMaterialDialog state={materialState} onOpenChange={(open) => { if (!open) setMaterialState(null) }} onUpdate={props.onUpdate} />
  </div>
}

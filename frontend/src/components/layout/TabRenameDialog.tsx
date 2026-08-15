import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { useAppStore, type Tab } from '@/store/appStore'
import { t } from '@/i18n'


export function TabRenameDialog({ tabID, tabs, onOpenChange }: {
  tabID: string | null
  tabs: Tab[]
  onOpenChange: (tabID: string | null) => void
}) {
  const tab = tabID ? tabs.find((item) => item.id === tabID) : undefined
  const [title, setTitle] = useState('')
  useEffect(() => {
    if (tab) setTitle(tab.title)
  }, [tab])
  const renameTab = useAppStore((state) => state.renameTerminalTab)
  const save = () => {
    if (!tabID || !tab) return
    const trimmed = title.trim()
    if (trimmed) renameTab(tabID, trimmed)
    onOpenChange(null)
  }
  return (
    <Dialog open={tabID !== null && tab !== undefined} onOpenChange={(open) => { if (!open) onOpenChange(null) }}>
      <DialogContent showCloseButton className="sm:max-w-sm">
        <DialogHeader><DialogTitle>{t('重命名终端标签')}</DialogTitle></DialogHeader>
        <Input aria-label={t('终端标签名称')} value={title} onChange={(event) => setTitle(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') save() }} autoFocus />
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(null)}>{t('取消')}</Button>
          <Button type="button" disabled={!title.trim()} onClick={save}>{t('保存')}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

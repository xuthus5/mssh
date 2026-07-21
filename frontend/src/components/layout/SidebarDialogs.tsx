import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import SessionDialog from '@/components/session/SessionDialog'
import type { Folder, Session } from '@/hooks/useSession'
import type { AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import type { AssetColorToken } from '@/lib/sessionModels'
import { t } from '@/i18n'


interface Props {
  sessionDialogOpen: boolean
  onSessionOpenChange: (open: boolean) => void
  editingSession: Session | null
  onSaveSession: (session: Omit<Session, 'id'>) => Promise<void>
  folders: Folder[]
  environments: AssetEnvironment[]
  projects: AssetProject[]
  assetTags: AssetTag[]
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
  folderDialogOpen: boolean
  onFolderOpenChange: (open: boolean) => void
  editingFolder: Folder | null
  folderName: string
  setFolderName: (name: string) => void
  onCreateOrUpdateFolder: () => void
}

export function SidebarDialogs(props: Props) {
  return <>
    <SessionDialog key={props.sessionDialogOpen ? 'open' : 'closed'} open={props.sessionDialogOpen} onOpenChange={props.onSessionOpenChange} session={props.editingSession} folders={props.folders} environments={props.environments} projects={props.projects} assetTags={props.assetTags} onCreateEnvironment={props.onCreateEnvironment} onCreateProject={props.onCreateProject} onCreateTag={props.onCreateTag} onSave={props.onSaveSession} />
    <Dialog open={props.folderDialogOpen} onOpenChange={props.onFolderOpenChange}>
      <DialogContent className="sm:max-w-sm"><DialogHeader><DialogTitle>{props.editingFolder ? t('编辑分组') : t('新建分组')}</DialogTitle></DialogHeader><div className="flex flex-col gap-3"><label className="text-xs font-medium text-muted-foreground" htmlFor="sidebar-folder-name">{t('分组名称')}</label><Input id="sidebar-folder-name" value={props.folderName} onChange={(event) => props.setFolderName(event.target.value)} placeholder={t('例如：生产环境')} onKeyDown={(event) => { if (event.key === 'Enter') props.onCreateOrUpdateFolder() }} /></div><DialogFooter><Button variant="outline" onClick={() => props.onFolderOpenChange(false)}>{t('取消')}</Button><Button onClick={props.onCreateOrUpdateFolder}>{props.editingFolder ? t('保存') : t('创建')}</Button></DialogFooter></DialogContent>
    </Dialog>
  </>
}

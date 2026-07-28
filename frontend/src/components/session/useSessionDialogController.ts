import { useEffect, useRef, useState } from 'react'
import { KeyService } from '@/lib/wails'
import type { AssetEnvironment, AssetProject, AssetTag, Folder, Session } from '@/hooks/useSession'
import type { AssetColorToken } from '@/lib/sessionModels'
import { t } from '@/i18n'

export interface SessionDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  session?: Session | null
  folders?: Folder[]
  environments: AssetEnvironment[]
  projects: AssetProject[]
  assetTags: AssetTag[]
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
  onSave: (data: Omit<Session, 'id'>) => Promise<void>
}

interface KeyItem { id: number; name: string; type: string }

export function useSessionDialogController(props: SessionDialogProps) {
  const fields = useSessionDialogFields(props)
  const runtime = useSessionDialogRuntime(props.open, props.session?.id)
  const keys = useSessionKeyList(props.open, runtime.lifecycle)
  const handleSubmit = createSessionSubmit({ props, fields, runtime })
  const handleOpenChange = (open: boolean) => changeSessionDialogOpen({ open, runtime, onOpenChange: props.onOpenChange })
  return { ...fields, ...keys, pending: runtime.pending, submitError: runtime.submitError,
    handleSubmit, handleOpenChange, isEditing: Boolean(props.session) }
}

function useSessionDialogFields(props: SessionDialogProps) {
  const session = props.session
  const [name, setName] = useState(session?.name ?? '')
  const [host, setHost] = useState(session?.host ?? '')
  const [port, setPort] = useState(session?.port?.toString() ?? '22')
  const [username, setUsername] = useState(session?.username ?? '')
  const [notes, setNotes] = useState(session?.notes ?? '')
  const [environmentId, setEnvironmentId] = useState(session?.environmentId ?? '')
  const [projectId, setProjectId] = useState(session?.projectId ?? '')
  const [tagIds, setTagIds] = useState(() => (session?.tags ?? []).map((tag) => tag.id))
  const [authMethod, setAuthMethod] = useState<string>(session?.authMethod ?? 'password')
  const [password, setPassword] = useState(session?.password ?? '')
  const [keyId, setKeyId] = useState<string>(session?.keyId ?? '')
  const [keepAlive, setKeepAlive] = useState(session?.keepAlive?.toString() ?? '0')
  const [termType, setTermType] = useState(session?.termType ?? 'xterm-256color')
  const defaultFolderID = props.folders?.find((folder) => folder.isDefault)?.id ?? ''
  const [folderId, setFolderId] = useState(session?.folderId ?? defaultFolderID)
  useEffect(() => {
    if (!props.open) return
    setName(session?.name ?? ''); setHost(session?.host ?? '')
    setPort(session?.port?.toString() ?? '22'); setUsername(session?.username ?? '')
    setNotes(session?.notes ?? ''); setEnvironmentId(session?.environmentId ?? '')
    setProjectId(session?.projectId ?? ''); setTagIds((session?.tags ?? []).map((tag) => tag.id))
    setAuthMethod(session?.authMethod ?? 'password'); setPassword(session?.password ?? '')
    setKeyId(session?.keyId ?? ''); setKeepAlive(session?.keepAlive?.toString() ?? '0')
    setTermType(session?.termType ?? 'xterm-256color'); setFolderId(session?.folderId ?? defaultFolderID)
  }, [props.open, session?.id])
  useEffect(() => {
    if (props.open) setFolderId(session?.folderId ?? defaultFolderID)
  }, [defaultFolderID, props.open, session?.folderId])
  return { name, setName, host, setHost, port, setPort, username, setUsername, notes, setNotes,
    environmentId, setEnvironmentId, projectId, setProjectId, tagIds, setTagIds,
    authMethod, setAuthMethod, password, setPassword, keyId, setKeyId, keepAlive, setKeepAlive,
    termType, setTermType, folderId, setFolderId }
}

function useSessionDialogRuntime(open: boolean, sessionID?: string) {
  const lifecycle = useLifecycleRef()
  const dialogGeneration = useRef(0)
  const saveRequestID = useRef(0)
  const saveActive = useRef(false)
  const openRef = useRef(open)
  const [pending, setPending] = useState(false)
  const [submitError, setSubmitError] = useState('')
  openRef.current = open
  useEffect(() => {
    openRef.current = open; dialogGeneration.current++
    setPending(saveActive.current); setSubmitError('')
  }, [open, sessionID])
  return { lifecycle, dialogGeneration, saveRequestID, saveActive, openRef,
    pending, setPending, submitError, setSubmitError }
}

function useSessionKeyList(open: boolean, lifecycle: { current: number }) {
  const [keys, setKeys] = useState<KeyItem[]>([])
  const [keysError, setKeysError] = useState('')
  const keyRequestID = useRef(0)
  useEffect(() => {
    const requestID = ++keyRequestID.current
    const lifecycleToken = lifecycle.current
    if (!open) return () => { if (keyRequestID.current === requestID) keyRequestID.current++ }
    setKeys([]); setKeysError('')
    KeyService.List().then((list) => {
      if (lifecycle.current !== lifecycleToken || keyRequestID.current !== requestID) return
      setKeys(list as KeyItem[]); setKeysError('')
    }).catch((error: unknown) => {
      if (lifecycle.current !== lifecycleToken || keyRequestID.current !== requestID) return
      setKeys([]); setKeysError(error instanceof Error ? error.message : String(error))
    })
    return () => { if (keyRequestID.current === requestID) keyRequestID.current++ }
  }, [lifecycle, open])
  const keyOptions = keys.map((key) => ({ value: String(key.id), label: `${key.name} (${key.type})` }))
  return { keys, keysError, keyOptions }
}

type SessionFields = ReturnType<typeof useSessionDialogFields>
type SessionRuntime = ReturnType<typeof useSessionDialogRuntime>

function createSessionSubmit(context: { props: SessionDialogProps; fields: SessionFields; runtime: SessionRuntime }) {
  return async () => {
    const { props, fields, runtime } = context
    if (fields.authMethod === 'key' && !fields.keyId) {
      runtime.setSubmitError(t('请选择 SSH 密钥'))
      return
    }
    if (runtime.saveActive.current) return
    const request = beginSaveRequest(runtime)
    runtime.setPending(true); runtime.setSubmitError('')
    try {
      await props.onSave(buildSessionData(props, fields))
      if (request.isCurrent()) changeSessionDialogOpen({ open: false, runtime, onOpenChange: props.onOpenChange, force: true })
    } catch (error) {
      if (request.isCurrent()) runtime.setSubmitError(saveErrorMessage(props.session, error))
    } finally {
      if (runtime.saveRequestID.current === request.id) runtime.saveActive.current = false
      if (request.isLatest()) runtime.setPending(false)
    }
  }
}

function buildSessionData(props: SessionDialogProps, fields: SessionFields): Omit<Session, 'id'> {
  const needsPassword = fields.authMethod === 'password' || fields.authMethod === 'keyboard-interactive'
  return {
    name: fields.name.trim(), host: fields.host.trim(), port: parseInt(fields.port, 10) || 22,
    username: fields.username.trim(), authMethod: fields.authMethod as Session['authMethod'],
    tags: props.assetTags.filter((tag) => fields.tagIds.includes(tag.id)), notes: fields.notes.trim(),
    environmentId: fields.environmentId || undefined, projectId: fields.projectId || undefined,
    password: needsPassword ? fields.password : undefined, keyId: fields.authMethod === 'key' ? fields.keyId : undefined,
    keepAlive: Math.max(0, Number.parseInt(fields.keepAlive, 10) || 0),
    termType: fields.termType.trim() || 'xterm-256color', folderId: fields.folderId || null,
  }
}

function beginSaveRequest(runtime: SessionRuntime) {
  runtime.saveActive.current = true
  const lifecycleToken = runtime.lifecycle.current
  const generation = runtime.dialogGeneration.current
  const id = ++runtime.saveRequestID.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.saveRequestID.current === id
  return { id, isLatest, isCurrent: () => isLatest()
    && runtime.dialogGeneration.current === generation && runtime.openRef.current }
}

function changeSessionDialogOpen(context: { open: boolean; runtime: SessionRuntime; onOpenChange: (open: boolean) => void; force?: boolean }) {
  if (!context.open && context.runtime.saveActive.current && !context.force) return
  context.runtime.openRef.current = context.open
  if (!context.open) {
    context.runtime.dialogGeneration.current++; context.runtime.saveRequestID.current++
    context.runtime.saveActive.current = false; context.runtime.setPending(false)
  }
  context.onOpenChange(context.open)
}

function saveErrorMessage(session: Session | null | undefined, error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  return session ? t('更新会话失败: ${}', message) : t('创建会话失败: ${}', message)
}

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}

import { useEffect, useRef, useState } from 'react'
import type { AssetColorToken, AssetEnvironment, AssetProject, AssetTag } from '@/hooks/useSession'
import { AssetCatalogService } from '@/lib/wails'

export type CatalogKind = 'environment' | 'project' | 'tag'
export type CatalogItem = AssetEnvironment | AssetProject | AssetTag
export interface CatalogEditorTarget { kind: CatalogKind; item?: CatalogItem }
export interface CatalogDeleteTarget { kind: CatalogKind; item: CatalogItem }

export interface CatalogEditorProps {
  target: CatalogEditorTarget | null
  onOpenChange: (open: boolean) => void
  onCreateEnvironment: (name: string, color: AssetColorToken) => Promise<AssetEnvironment>
  onCreateProject: (name: string, code: string, description?: string) => Promise<AssetProject>
  onCreateTag: (name: string, color: AssetColorToken) => Promise<AssetTag>
  onUpdateEnvironment: (item: AssetEnvironment) => Promise<void>
  onUpdateProject: (item: AssetProject) => Promise<void>
  onUpdateTag: (item: AssetTag) => Promise<void>
}

export interface CatalogDeleteProps {
  target: CatalogDeleteTarget | null
  environments: AssetEnvironment[]
  projects: AssetProject[]
  onOpenChange: (open: boolean) => void
  onDeleteEnvironment: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => Promise<void>
  onDeleteProject: (id: string, mode: 'migrate' | 'clear', replacementID: string | null) => Promise<void>
  onDeleteTag: (id: string) => Promise<void>
}

export function useCatalogEditorDialog(props: CatalogEditorProps) {
  const state = useCatalogEditorState()
  const runtime = useCatalogEditorRuntime(props.target, state)
  const submit = createCatalogEditorSubmit({ props, state, runtime })
  const handleOpenChange = (open: boolean) => changeCatalogEditorOpen({ open, state, runtime, onOpenChange: props.onOpenChange })
  return { ...state, submit, handleOpenChange }
}

function useCatalogEditorState() {
  const [name, setName] = useState('')
  const [code, setCode] = useState('')
  const [description, setDescription] = useState('')
  const [color, setColor] = useState<AssetColorToken>('slate')
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return { name, setName, code, setCode, description, setDescription, color, setColor,
    pending, setPending, error, setError }
}

function useCatalogEditorRuntime(target: CatalogEditorTarget | null, state: ReturnType<typeof useCatalogEditorState>) {
  const lifecycle = useLifecycleRef()
  const targetGeneration = useRef(0)
  const saveRequest = useRef(0)
  const saveActive = useRef(false)
  useEffect(() => {
    targetGeneration.current++
    state.setName(target?.item?.name ?? '')
    state.setCode(target?.kind === 'project' && target.item ? (target.item as AssetProject).code : '')
    state.setDescription(target?.kind === 'project' && target.item ? (target.item as AssetProject).description : '')
    state.setColor(target?.kind !== 'project' && target?.item ? (target.item as AssetEnvironment | AssetTag).colorToken : 'slate')
    state.setPending(saveActive.current); state.setError('')
  }, [target])
  return { lifecycle, targetGeneration, saveRequest, saveActive }
}

type EditorState = ReturnType<typeof useCatalogEditorState>
type EditorRuntime = ReturnType<typeof useCatalogEditorRuntime>

function createCatalogEditorSubmit(context: { props: CatalogEditorProps; state: EditorState; runtime: EditorRuntime }) {
  return async () => {
    const { props, state, runtime } = context
    if (!props.target || runtime.saveActive.current) return
    const request = beginEditorRequest(runtime)
    const target = props.target
    state.setPending(true); state.setError('')
    try {
      await saveCatalog(props, target, catalogValues(state))
      if (request.isCurrent()) changeCatalogEditorOpen({ open: false, state, runtime, onOpenChange: props.onOpenChange, force: true })
    } catch (reason) {
      if (request.isCurrent()) state.setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (runtime.saveRequest.current === request.id) runtime.saveActive.current = false
      if (request.isLatest()) state.setPending(false)
    }
  }
}

async function saveCatalog(props: CatalogEditorProps, target: CatalogEditorTarget, values: ReturnType<typeof catalogValues>) {
  if (!target.item) {
    if (target.kind === 'environment') await props.onCreateEnvironment(values.name, values.color)
    else if (target.kind === 'project') await props.onCreateProject(values.name, values.code, values.description)
    else await props.onCreateTag(values.name, values.color)
    return
  }
  if (target.kind === 'environment') await props.onUpdateEnvironment({ ...(target.item as AssetEnvironment), name: values.name, colorToken: values.color })
  else if (target.kind === 'project') await props.onUpdateProject({ ...(target.item as AssetProject), name: values.name, code: values.code, description: values.description })
  else await props.onUpdateTag({ ...(target.item as AssetTag), name: values.name, colorToken: values.color })
}

function changeCatalogEditorOpen(context: { open: boolean; state: EditorState; runtime: EditorRuntime; onOpenChange: (open: boolean) => void; force?: boolean }) {
  if (!context.open && context.runtime.saveActive.current && !context.force) return
  if (!context.open) {
    context.runtime.targetGeneration.current++; context.runtime.saveRequest.current++
    context.runtime.saveActive.current = false; context.state.setPending(false); context.state.setError('')
  }
  context.onOpenChange(context.open)
}

export function useCatalogDeleteDialog(props: CatalogDeleteProps) {
  const state = useCatalogDeleteState()
  const runtime = useCatalogDeleteRuntime()
  const alternatives = catalogAlternatives(props)
  useCatalogDeleteImpact({ props, state, runtime, alternatives })
  const submit = createCatalogDeleteSubmit({ props, state, runtime })
  const handleOpenChange = (open: boolean) => changeCatalogDeleteOpen({ open, state, runtime, onOpenChange: props.onOpenChange })
  const retryImpact = () => {
    if (!props.target || state.pending || state.impactPending) return
    state.setImpactRevision((value) => value + 1)
  }
  const isTag = props.target?.kind === 'tag'
  const canSubmit = Boolean(state.impact) && (isTag || state.mode === 'clear' || Boolean(state.replacementID))
  return { ...state, alternatives, isTag, canSubmit, submit, handleOpenChange, retryImpact }
}

function useCatalogDeleteState() {
  const [impact, setImpact] = useState<{ name: string; session_count: number } | null>(null)
  const [mode, setMode] = useState<'migrate' | 'clear'>('migrate')
  const [replacementID, setReplacementID] = useState('')
  const [impactPending, setImpactPending] = useState(false)
  const [impactRevision, setImpactRevision] = useState(0)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState('')
  return { impact, setImpact, mode, setMode, replacementID, setReplacementID, impactPending, setImpactPending,
    impactRevision, setImpactRevision, pending, setPending, error, setError }
}

function useCatalogDeleteRuntime() {
  return { lifecycle: useLifecycleRef(), targetGeneration: useRef(0), impactRequest: useRef(0),
    deleteRequest: useRef(0), deleteActive: useRef(false), targetKey: useRef('') }
}

type DeleteState = ReturnType<typeof useCatalogDeleteState>
type DeleteRuntime = ReturnType<typeof useCatalogDeleteRuntime>

function useCatalogDeleteImpact(context: {
  props: CatalogDeleteProps
  state: DeleteState
  runtime: DeleteRuntime
  alternatives: CatalogItem[]
}) {
  const targetKey = catalogDeleteTargetKey(context.props.target)
  useEffect(() => {
    const { props, state, runtime, alternatives } = context
    if (runtime.targetKey.current !== targetKey) {
      runtime.targetKey.current = targetKey
      runtime.targetGeneration.current++
      state.setReplacementID('')
      state.setMode(props.target?.kind === 'tag' || alternatives.length === 0 ? 'clear' : 'migrate')
    }
    runtime.impactRequest.current++
    state.setImpact(null); state.setError('')
    if (!props.target) { state.setImpactPending(false); return }
    const generation = runtime.targetGeneration.current
    const request = beginImpactRequest(runtime, generation)
    const target = props.target
    state.setImpactPending(true)
    void loadCatalogImpact(target).then((value) => {
      if (request.isCurrent()) state.setImpact(value ? { name: value.name, session_count: value.session_count } : null)
    }).catch((reason) => {
      if (request.isCurrent()) state.setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (request.isCurrent()) state.setImpactPending(false)
    })
  }, [context.state.impactRevision, targetKey])
}

function createCatalogDeleteSubmit(context: { props: CatalogDeleteProps; state: DeleteState; runtime: DeleteRuntime }) {
  return async () => {
    const { props, state, runtime } = context
    if (!props.target || runtime.deleteActive.current) return
    const request = beginDeleteRequest(runtime)
    const target = props.target
    state.setPending(true); state.setError('')
    try {
      await deleteCatalogTarget(props, target, state)
      if (request.isCurrent()) changeCatalogDeleteOpen({ open: false, state, runtime, onOpenChange: props.onOpenChange, force: true })
    } catch (reason) {
      if (request.isCurrent()) state.setError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      if (runtime.deleteRequest.current === request.id) runtime.deleteActive.current = false
      if (request.isLatest()) state.setPending(false)
    }
  }
}

function changeCatalogDeleteOpen(context: { open: boolean; state: DeleteState; runtime: DeleteRuntime; onOpenChange: (open: boolean) => void; force?: boolean }) {
  if (!context.open && context.runtime.deleteActive.current && !context.force) return
  if (!context.open) {
    context.runtime.targetGeneration.current++; context.runtime.impactRequest.current++; context.runtime.deleteRequest.current++
    context.runtime.deleteActive.current = false; context.state.setPending(false); context.state.setError('')
  }
  context.onOpenChange(context.open)
}

async function deleteCatalogTarget(props: CatalogDeleteProps, target: CatalogDeleteTarget, state: DeleteState) {
  if (target.kind === 'environment') await props.onDeleteEnvironment(target.item.id, state.mode, state.replacementID || null)
  else if (target.kind === 'project') await props.onDeleteProject(target.item.id, state.mode, state.replacementID || null)
  else await props.onDeleteTag(target.item.id)
}

function beginEditorRequest(runtime: EditorRuntime) {
  runtime.saveActive.current = true
  const lifecycleToken = runtime.lifecycle.current
  const generation = runtime.targetGeneration.current
  const id = ++runtime.saveRequest.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.saveRequest.current === id
  return { id, isLatest, isCurrent: () => isLatest() && runtime.targetGeneration.current === generation }
}

function beginImpactRequest(runtime: DeleteRuntime, generation: number) {
  const lifecycleToken = runtime.lifecycle.current
  const id = ++runtime.impactRequest.current
  return { isCurrent: () => runtime.lifecycle.current === lifecycleToken
    && runtime.targetGeneration.current === generation && runtime.impactRequest.current === id }
}

function beginDeleteRequest(runtime: DeleteRuntime) {
  runtime.deleteActive.current = true
  const lifecycleToken = runtime.lifecycle.current
  const generation = runtime.targetGeneration.current
  const id = ++runtime.deleteRequest.current
  const isLatest = () => runtime.lifecycle.current === lifecycleToken && runtime.deleteRequest.current === id
  return { id, isLatest, isCurrent: () => isLatest() && runtime.targetGeneration.current === generation }
}

function catalogDeleteTargetKey(target: CatalogDeleteTarget | null) {
  return target ? `${target.kind}:${target.item.id}` : ''
}

function catalogValues(state: EditorState) {
  return { name: state.name.trim(), code: state.code.trim(), description: state.description.trim(), color: state.color }
}

function catalogAlternatives(props: CatalogDeleteProps) {
  if (props.target?.kind === 'environment') return props.environments.filter((item) => item.id !== props.target?.item.id)
  if (props.target?.kind === 'project') return props.projects.filter((item) => item.id !== props.target?.item.id)
  return []
}

function loadCatalogImpact(target: CatalogDeleteTarget) {
  const load = target.kind === 'environment' ? AssetCatalogService.EnvironmentDeleteImpact
    : target.kind === 'project' ? AssetCatalogService.ProjectDeleteImpact : AssetCatalogService.TagDeleteImpact
  return load(Number(target.item.id))
}

function useLifecycleRef() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}

import { useEffect, useRef, useState, type FormEvent } from 'react'
import type { KeyImportFile, KeyInfo } from '@/hooks/useSettings'
import { t } from '@/i18n'

type DialogTarget = { lifecycle: number; generation: number }

export function useDialogTarget(targetKey: unknown) {
  const lifecycle = useRef(0)
  const generation = useRef(0)
  const previousTarget = useRef(targetKey)
  if (!Object.is(previousTarget.current, targetKey)) {
    previousTarget.current = targetKey
    generation.current++
  }
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  const capture = (): DialogTarget => ({ lifecycle: lifecycle.current, generation: generation.current })
  const isCurrent = (target: DialogTarget) => lifecycle.current === target.lifecycle && generation.current === target.generation
  const isMounted = (target: DialogTarget) => lifecycle.current === target.lifecycle
  return { capture, isCurrent, isMounted }
}

export interface KeyImportDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  onImport: (name: string, privateKey: string) => Promise<KeyInfo | undefined>
  onSelectFile: () => Promise<KeyImportFile | undefined>
}

function useImportState(props: KeyImportDialogProps) {
  const [name, setName] = useState('')
  const [privateKey, setPrivateKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [browsing, setBrowsing] = useState(false)
  const [formError, setFormError] = useState('')
  const target = useDialogTarget(props.open)
  const operationRequest = useRef(0)
  const operationActive = useRef(false)
  const editGeneration = useRef(0)
  const openRef = useRef(props.open)
  const autoBrowsePending = useRef(false)
  const onSelectFileRef = useRef(props.onSelectFile)
  openRef.current = props.open
  onSelectFileRef.current = props.onSelectFile
  return { name, setName, privateKey, setPrivateKey, saving, setSaving, browsing, setBrowsing,
    formError, setFormError, target, operationRequest, operationActive, editGeneration,
    openRef, autoBrowsePending, onSelectFileRef }
}

type ImportState = ReturnType<typeof useImportState>

function useImportBrowser(state: ImportState) {
  const browse = async () => {
    if (state.operationActive.current) return
    state.operationActive.current = true
    state.autoBrowsePending.current = false
    const targetToken = state.target.capture()
    const editToken = state.editGeneration.current
    const request = ++state.operationRequest.current
    const isLatest = () => state.target.isMounted(targetToken) && state.operationRequest.current === request
    const isCurrent = () => isLatest() && state.target.isCurrent(targetToken) && state.editGeneration.current === editToken
    state.setBrowsing(true)
    state.setFormError('')
    try {
      const file = await state.onSelectFileRef.current()
      if (file && isCurrent()) {
        state.setName(file.name)
        state.setPrivateKey(file.privateKey)
      }
    } catch (error) {
      if (isCurrent()) state.setFormError(t('读取私钥文件失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (isLatest()) {
        state.operationActive.current = false
        state.setBrowsing(false)
        if (state.autoBrowsePending.current && state.openRef.current) void browse()
      }
    }
  }
  return browse
}

function useImportSubmit(props: KeyImportDialogProps, state: ImportState, browse: () => Promise<void>) {
  return async (event: FormEvent) => {
    event.preventDefault()
    if (state.operationActive.current) return
    state.operationActive.current = true
    state.autoBrowsePending.current = false
    const targetToken = state.target.capture()
    const request = ++state.operationRequest.current
    const isLatest = () => state.target.isMounted(targetToken) && state.operationRequest.current === request
    const isCurrent = () => isLatest() && state.target.isCurrent(targetToken)
    state.setSaving(true)
    state.setFormError('')
    try {
      if (await props.onImport(state.name, state.privateKey)) {
        if (isCurrent()) props.onOpenChange(false)
      }
    } catch (error) {
      if (isCurrent()) state.setFormError(t('导入密钥失败: ${}', error instanceof Error ? error.message : String(error)))
    } finally {
      if (isLatest()) {
        state.operationActive.current = false
        state.setSaving(false)
        if (state.autoBrowsePending.current && state.openRef.current) void browse()
      }
    }
  }
}

function useImportReset(open: boolean, state: ImportState, browse: () => Promise<void>) {
  useEffect(() => {
    state.editGeneration.current++
    state.setFormError('')
    if (!open) {
      state.autoBrowsePending.current = false
      state.setName('')
      state.setPrivateKey('')
      return
    }
    state.autoBrowsePending.current = true
    void browse()
  }, [open])
}

export function useKeyImportDialogRuntime(props: KeyImportDialogProps) {
  const state = useImportState(props)
  const browse = useImportBrowser(state)
  const submit = useImportSubmit(props, state, browse)
  useImportReset(props.open, state, browse)
  const changeName = (value: string) => { if (!state.operationActive.current) { state.editGeneration.current++; state.setName(value) } }
  const changePrivateKey = (value: string) => { if (!state.operationActive.current) { state.editGeneration.current++; state.setPrivateKey(value) } }
  const handleOpenChange = (open: boolean) => { if (open || !state.operationActive.current) props.onOpenChange(open) }
  const pending = state.saving || state.browsing
  return { name: state.name, privateKey: state.privateKey, saving: state.saving, browsing: state.browsing,
    pending, formError: state.formError, browse, submit, changeName, changePrivateKey, handleOpenChange }
}

export type KeyImportDialogRuntime = ReturnType<typeof useKeyImportDialogRuntime>

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AIProviderProfile, AIProviderProfileInput } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import { AIProviderType } from '../../../bindings/github.com/xuthus5/mssh/internal/model/models'
import type { AISettingsController } from '@/hooks/useAISettings'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'
import { requestConfirm } from '@/lib/confirmDialog'
import { t } from '@/i18n'

export function emptyProvider(): AIProviderProfileInput {
  return { id: 0, name: '', provider: AIProviderType.AIProviderOpenAICompatible, base_url: 'https://api.openai.com/v1', default_model: '', enabled: true, api_key: '' }
}

function providerInput(profile: AIProviderProfile): AIProviderProfileInput {
  return { id: profile.id, name: profile.name, provider: profile.provider, base_url: profile.base_url, default_model: profile.default_model, enabled: profile.enabled, api_key: '' }
}

function useProviderLifecycle() {
  const lifecycle = useRef(0)
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) lifecycle.current++ }
  }, [])
  return lifecycle
}

function useProviderTarget(controller: AISettingsController) {
  const dashboard = controller.dashboard
  const [selectedID, setSelectedID] = useState(0)
  const [draft, setDraft] = useState<AIProviderProfileInput>(emptyProvider)
  const lifecycle = useProviderLifecycle()
  const targetGeneration = useRef(0)
  const operationActive = useRef(false)
  const draftRevision = useRef(0)
  const draftDirty = useRef(false)
  const syncedProviderID = useRef<number | null | undefined>(undefined)
  const selected = useMemo(() => dashboard?.providers.find((item) => item.id === selectedID), [dashboard, selectedID])
  const syncDraft = useCallback((providerID: number | null, next: AIProviderProfileInput) => {
    draftDirty.current = false
    draftRevision.current++
    syncedProviderID.current = providerID
    setDraft(next)
  }, [])
  useEffect(() => {
    if (selected) {
      if (syncedProviderID.current !== selected.id || !draftDirty.current) syncDraft(selected.id, providerInput(selected))
    } else if (selectedID === 0) {
      if (syncedProviderID.current !== 0 || !draftDirty.current) syncDraft(0, emptyProvider())
    } else if (dashboard) {
      targetGeneration.current++
      setSelectedID(0)
      syncDraft(0, emptyProvider())
    }
  }, [dashboard, selected, selectedID, syncDraft])
  const updateDraft = (update: (current: AIProviderProfileInput) => AIProviderProfileInput) => {
    draftDirty.current = true
    draftRevision.current++
    setDraft(update)
  }
  const selectProvider = (profile: AIProviderProfile) => { targetGeneration.current++; syncDraft(profile.id, providerInput(profile)); setSelectedID(profile.id) }
  const selectNewProvider = () => { targetGeneration.current++; syncDraft(0, emptyProvider()); setSelectedID(0) }
  const resetTransientTarget = useCallback(() => {
    targetGeneration.current++
    const saved = dashboard?.providers.find((profile) => profile.id === selectedID)
    if (saved) {
      syncDraft(saved.id, providerInput(saved))
      return
    }
    setSelectedID(0)
    syncDraft(0, emptyProvider())
  }, [dashboard, selectedID, syncDraft])
  useSettingsWindowHide(resetTransientTarget)
  const captureTarget = () => ({ lifecycleToken: lifecycle.current, targetToken: targetGeneration.current })
  const isCurrentTarget = (target: ReturnType<typeof captureTarget>) => lifecycle.current === target.lifecycleToken && targetGeneration.current === target.targetToken
  return { dashboard, selectedID, setSelectedID, draft, selected, draftRevision, targetGeneration, operationActive, syncDraft, updateDraft, selectProvider, selectNewProvider, captureTarget, isCurrentTarget }
}

type ProviderTarget = ReturnType<typeof useProviderTarget>

function useSaveProvider(controller: AISettingsController, target: ProviderTarget) {
  const [saving, setSaving] = useState(false)
  const save = async () => {
    if (target.operationActive.current) return
    target.operationActive.current = true
    setSaving(true)
    const captured = target.captureTarget()
    const revision = target.draftRevision.current
    try {
      const saved = await controller.saveProvider(target.draft)
      if (saved && target.isCurrentTarget(captured) && target.draftRevision.current === revision) {
        target.targetGeneration.current++
        target.syncDraft(saved.id, providerInput(saved))
        target.setSelectedID(saved.id)
      }
    } finally {
      target.operationActive.current = false
      setSaving(false)
    }
  }
  return { saving, save }
}

function useDeleteProvider(controller: AISettingsController, target: ProviderTarget, onProviderDeleted: (providerID: number) => void) {
  const [deleting, setDeleting] = useState(false)
  const deleteSelected = async () => {
    if (!target.draft.id || target.operationActive.current) return
    target.operationActive.current = true
    setDeleting(true)
    const captured = target.captureTarget()
    const targetID = target.draft.id
    try {
      const confirmed = await requestConfirm({ title: t('删除提供商'), description: t('确认删除提供商「${}」？此操作不可撤销。', target.draft.name || t('未命名提供商')), confirmLabel: t('删除'), cancelLabel: t('取消'), destructive: true })
      if (!confirmed || !target.isCurrentTarget(captured)) return
      await controller.deleteProvider(targetID)
      onProviderDeleted(targetID)
      if (target.isCurrentTarget(captured)) {
        target.targetGeneration.current++
        target.syncDraft(0, emptyProvider())
        target.setSelectedID(0)
      }
    } finally {
      target.operationActive.current = false
      setDeleting(false)
    }
  }
  return { deleting, deleteSelected }
}

function useTestProvider(controller: AISettingsController, target: ProviderTarget) {
  const [testing, setTesting] = useState(false)
  const testSelected = async () => {
    if (!target.draft.id || target.operationActive.current) return
    target.operationActive.current = true
    setTesting(true)
    const targetID = target.draft.id
    try {
      await controller.testProvider(targetID)
    } finally {
      target.operationActive.current = false
      setTesting(false)
    }
  }
  return { testing, testSelected }
}

export function useAIProviderPanelRuntime(controller: AISettingsController, onProviderDeleted: (providerID: number) => void) {
  const target = useProviderTarget(controller)
  const saving = useSaveProvider(controller, target)
  const deletion = useDeleteProvider(controller, target, onProviderDeleted)
  const testing = useTestProvider(controller, target)
  return { ...target, ...saving, ...deletion, ...testing }
}

export type AIProviderPanelRuntime = ReturnType<typeof useAIProviderPanelRuntime>

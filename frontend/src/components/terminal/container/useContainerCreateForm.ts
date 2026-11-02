import { useEffect, useMemo, useState } from 'react'
import { toast } from '@/components/ui/toast'
import { t } from '@/i18n'
import { logger } from '@/lib/logger'
import { TerminalService } from '@/lib/wails'
import {
  ContainerCreateRequest,
  type ContainerEngineInfo,
} from '../../../../bindings/github.com/xuthus5/mssh/internal/model/models'

export const RESTART_OPTIONS = [
  { value: '', label: '不自动重启' },
  { value: 'always', label: '始终重启' },
  { value: 'unless-stopped', label: '除非手动停止' },
  { value: 'on-failure', label: '失败时重启' },
] as const

export interface ContainerDraft {
  namespace: string
  image: string
  name: string
  command: string
  env: string
  ports: string
  volumes: string
  restartPolicy: string
}

const EMPTY_DRAFT: ContainerDraft = {
  namespace: 'default', image: '', name: '', command: '', env: '', ports: '', volumes: '', restartPolicy: '',
}

function lines(value: string): string[] {
  return value.split('\n').map((line) => line.trim()).filter(Boolean)
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function useContainerCreateForm({ terminalID, engines, open, onCreated, onOpenChange }: {
  terminalID: string
  engines: ContainerEngineInfo[]
  open: boolean
  onCreated: () => void
  onOpenChange: (open: boolean) => void
}) {
  const availableEngines = useMemo(() => engines.filter((engine) => engine.available), [engines])
  const [engine, setEngine] = useState('')
  const [draft, setDraft] = useState<ContainerDraft>(EMPTY_DRAFT)
  const [submitting, setSubmitting] = useState(false)
  useEffect(() => {
    if (open && !availableEngines.some((item) => item.name === engine)) setEngine(availableEngines[0]?.name ?? '')
  }, [availableEngines, engine, open])
  const update = (field: keyof ContainerDraft, value: string) => setDraft((current) => ({ ...current, [field]: value }))
  const isContainerd = engine === 'containerd'
  const canSubmit = !submitting && Boolean(engine && draft.image.trim() && draft.name.trim())
  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      await TerminalService.CreateContainer(terminalID, new ContainerCreateRequest({
        engine,
        namespace: isContainerd ? draft.namespace.trim() || 'default' : '',
        image: draft.image.trim(),
        name: draft.name.trim(),
        command: lines(draft.command),
        env: lines(draft.env),
        ports: isContainerd ? [] : lines(draft.ports),
        volumes: lines(draft.volumes),
        restart_policy: isContainerd ? '' : draft.restartPolicy,
      }))
      toast(t('容器已创建'), 'success')
      setDraft(EMPTY_DRAFT)
      onCreated()
      onOpenChange(false)
    } catch (error: unknown) {
      logger.error('create container failed', error)
      toast(t('创建容器失败: ${}', errorMessage(error)), 'error')
    } finally {
      setSubmitting(false)
    }
  }
  return { availableEngines, engine, setEngine, draft, update, isContainerd, canSubmit, submitting, submit }
}

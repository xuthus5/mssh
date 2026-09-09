import { useCallback, useEffect, useRef, useState } from 'react'
import { t } from '@/i18n'
import type { Session, SSHJumpHost } from '@/lib/sessionModels'
import { toSSHJumpHostInput } from '@/lib/sshJumpHost'
import { SessionService } from '@/lib/wails'
import { bindWailsCallToSignal } from '@/lib/wailsCancellation'
import { retireConnectionRequest } from '@/store/connectionRequestRegistry'

const DEFAULT_SSH_PORT = 22
const MAX_SSH_PORT = 65535
const AUTH_METHODS: Session['authMethod'][] = ['password', 'keyboard-interactive', 'key', 'agent']
const IDLE_TEST = { status: 'idle', message: '' } as const

interface SSHJumpHostDraft {
  enabled: boolean
  host: string
  port: string
  username: string
  authMethod: Session['authMethod']
  password: string
  keyId: string
}

interface JumpTestState { status: 'idle' | 'pending' | 'success' | 'error'; message: string }
interface JumpTestAttempt { controller: AbortController; requestId: string }

export function useSSHJumpHostForm(props: { open: boolean; session?: Session | null }) {
  const [draft, setDraft] = useState(() => createJumpDraft(props.session?.jumpHost))
  const [testState, setTestState] = useState<JumpTestState>(IDLE_TEST)
  const activeTest = useRef<JumpTestAttempt | null>(null)
  const cancelTest = useCallback(() => {
    cancelJumpTest(activeTest)
    setTestState(IDLE_TEST)
  }, [])
  useEffect(() => {
    cancelTest(); setDraft(createJumpDraft(props.session?.jumpHost))
    return () => cancelJumpTest(activeTest)
  }, [cancelTest, props.open, props.session?.id])
  const change = (patch: Partial<SSHJumpHostDraft>) => {
    cancelTest(); setDraft((previous) => ({ ...previous, ...patch }))
  }
  const testConnection = createJumpTest({ props, draft, activeTest, setTestState })
  return { draft, change, testState, testConnection, cancelTest,
    testing: testState.status === 'pending', isTesting: () => activeTest.current !== null,
    keepPassword: canKeepJumpPassword(draft, props.session?.jumpHost),
    validate: () => validateJumpDraft(draft), value: () => jumpDraftValue(draft) }
}

function cancelJumpTest(activeTest: { current: JumpTestAttempt | null }) {
  const attempt = activeTest.current
  activeTest.current = null
  if (!attempt) return
  retireConnectionRequest(attempt.requestId)
  attempt.controller.abort()
}

function createJumpDraft(jump?: SSHJumpHost): SSHJumpHostDraft {
  return {
    enabled: Boolean(jump), host: jump?.host ?? '', port: String(jump?.port ?? DEFAULT_SSH_PORT),
    username: jump?.username ?? '', authMethod: jump?.authMethod ?? 'password',
    password: jump?.password ?? '', keyId: jump?.keyId ?? '',
  }
}

function canKeepJumpPassword(draft: SSHJumpHostDraft, saved?: SSHJumpHost) {
  return Boolean(saved && saved.host === draft.host.trim() && saved.port === Number(draft.port)
    && saved.username === draft.username.trim() && saved.authMethod === draft.authMethod)
}

function validateJumpDraft(draft: SSHJumpHostDraft) {
  if (!draft.enabled) return ''
  if (!draft.host.trim()) return t('请输入隧道主机')
  const port = Number(draft.port)
  if (!Number.isInteger(port) || port < 1 || port > MAX_SSH_PORT) return t('隧道端口必须为 1–65535 的整数')
  if (!draft.username.trim()) return t('请输入隧道用户名')
  if (!AUTH_METHODS.includes(draft.authMethod)) return t('请选择有效的隧道认证方式')
  if (draft.authMethod === 'key' && (!Number.isSafeInteger(Number(draft.keyId)) || Number(draft.keyId) < 1)) return t('请选择隧道 SSH 密钥')
  return ''
}

function jumpDraftValue(draft: SSHJumpHostDraft): SSHJumpHost | undefined {
  if (!draft.enabled) return undefined
  const needsPassword = draft.authMethod === 'password' || draft.authMethod === 'keyboard-interactive'
  return {
    host: draft.host.trim(), port: Number(draft.port), username: draft.username.trim(),
    authMethod: draft.authMethod, password: needsPassword ? draft.password : undefined,
    keyId: draft.authMethod === 'key' ? draft.keyId : undefined,
  }
}

interface JumpTestContext {
  props: { open: boolean; session?: Session | null }
  draft: SSHJumpHostDraft
  activeTest: { current: JumpTestAttempt | null }
  setTestState: (state: JumpTestState) => void
}

function createJumpTest(context: JumpTestContext) {
  return async () => {
    const { props, draft, activeTest, setTestState } = context
    if (!props.open || !draft.enabled || activeTest.current) return
    const validationError = validateJumpDraft(draft)
    if (validationError) { setTestState({ status: 'error', message: validationError }); return }
    const attempt = { controller: new AbortController(), requestId: '' }
    activeTest.current = attempt
    setTestState({ status: 'pending', message: '' })
    try {
      attempt.requestId = crypto.randomUUID()
      const call = SessionService.TestSSHJumpHost({
        session_id: Number(props.session?.id) || 0, request_id: attempt.requestId,
        jump_host: toSSHJumpHostInput(jumpDraftValue(draft))!,
      })
      await bindWailsCallToSignal(call, attempt.controller.signal)
      if (activeTest.current === attempt) setTestState({ status: 'success', message: t('SSH 连接隧道测试成功') })
    } catch (error: unknown) {
      if (activeTest.current !== attempt) return
      const message = error instanceof Error ? error.message : String(error)
      setTestState({ status: 'error', message: t('SSH 连接隧道测试失败: ${}', message) })
    } finally {
      if (activeTest.current === attempt) activeTest.current = null
    }
  }
}

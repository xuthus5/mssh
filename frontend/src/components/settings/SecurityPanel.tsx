import { useCallback, useState } from 'react'
import { SecurityPanelView, type SecurityConfirmAction } from '@/components/settings/SecurityPanelSections'
import { SecurityService, SessionService } from '@/lib/wails'
import { validateAppPassword } from '@/lib/appPassword'
import { t } from '@/i18n'
import { useSecurityPanel } from '@/hooks/useSecurityPanel'
import { useSettingsWindowHide } from '@/hooks/useSettingsWindowHide'

type SecurityController = ReturnType<typeof useSecurityPanel>

interface PasswordValidation {
  password: string
  confirmation: string
  setError: (value: string) => void
}

function validatePassword({ password, confirmation, setError }: PasswordValidation): boolean {
  const validationError = validateAppPassword(password)
  if (validationError) {
    setError(t(validationError))
    return false
  }
  if (password !== confirmation) {
    setError(t('两次输入的密码不一致'))
    return false
  }
  return true
}

function useConfirmSecurityAction(
  security: SecurityController,
  confirmAction: SecurityConfirmAction,
  setConfirmAction: (action: SecurityConfirmAction) => void,
) {
  return useCallback(async () => {
    if (!confirmAction) return
    if (confirmAction.type === 'rotate') {
      const succeeded = await security.run(t('应用密码已轮转'), '轮转应用密码失败: ${}', () => SecurityService.Rotate({
        current_password: security.currentPassword, new_password: security.newPassword,
      }))
      if (succeeded) setConfirmAction(null)
      return
    }
    const succeeded = await security.run(t('主机指纹已删除'), '删除主机指纹失败: ${}', () => SessionService.DeleteHostKey(confirmAction.entry.line))
    if (succeeded) setConfirmAction(null)
  }, [confirmAction, security, setConfirmAction])
}

function useSecurityPanelActions(security: SecurityController) {
  const [confirmAction, setConfirmAction] = useState<SecurityConfirmAction>(null)
  const resetTransientState = security.resetTransientState
  useSettingsWindowHide(useCallback(() => {
    resetTransientState()
    setConfirmAction(null)
  }, [resetTransientState]))
  const setupPassword = () => {
    if (!validatePassword({ password: security.password, confirmation: security.confirmPassword, setError: security.setFormError })) return
    void security.run(t('应用密码已设置'), '设置应用密码失败: ${}', () => SecurityService.Setup({
      password: security.password,
      require_password_on_launch: security.requireLaunch,
      remember_unlock: security.rememberUnlock,
    }))
  }
  const rotatePassword = () => {
    if (!validatePassword({ password: security.newPassword, confirmation: security.confirmNewPassword, setError: security.setFormError })) return
    const currentPasswordError = validateAppPassword(security.currentPassword, false)
    if (currentPasswordError) return security.setFormError(t(currentPasswordError))
    security.setFormError('')
    setConfirmAction({ type: 'rotate' })
  }
  const unlockPassword = () => {
    const validationError = validateAppPassword(security.currentPassword, false)
    if (validationError) return security.setFormError(t(validationError))
    void security.run(t('已解锁'), '解锁失败: ${}', () => SecurityService.Unlock({
      password: security.currentPassword, remember_unlock: security.rememberUnlock,
    }))
  }
  const savePreferences = (requireLaunch: boolean, rememberUnlock: boolean) => {
    if (!security.canStart()) return
    if (!security.status.configured) {
      security.setRequireLaunch(requireLaunch)
      security.setRememberUnlock(rememberUnlock)
      return
    }
    void security.run(t('安全偏好已保存'), '保存安全偏好失败: ${}', () => SecurityService.SavePreferences({
      require_password_on_launch: requireLaunch, remember_unlock: rememberUnlock,
    }))
  }
  const confirm = useConfirmSecurityAction(security, confirmAction, setConfirmAction)
  return { confirmAction, setConfirmAction, setupPassword, rotatePassword, unlockPassword, savePreferences, confirm }
}

export function SecurityPanel() {
  const security = useSecurityPanel()
  const actions = useSecurityPanelActions(security)
  return <SecurityPanelView security={security} actions={actions} />
}

import type { SSHJumpHost } from '@/lib/sessionModels'
import type { AuthMethod } from '../../bindings/github.com/xuthus5/mssh/internal/model/models'

interface SSHJumpHostDTO {
  host: string
  port: number
  username: string
  auth_method: string
  password?: string
  key_id?: number | null
}

export function toSSHJumpHostInput(jump?: SSHJumpHost) {
  if (!jump) return undefined
  return {
    host: jump.host.trim(), port: jump.port, username: jump.username.trim(),
    auth_method: jump.authMethod as AuthMethod,
    password: jump.authMethod === 'password' || jump.authMethod === 'keyboard-interactive' ? jump.password : undefined,
    key_id: jump.authMethod === 'key' && jump.keyId ? Number(jump.keyId) : null,
  }
}

export function mapSSHJumpHost(jump?: SSHJumpHostDTO | null): SSHJumpHost | undefined {
  if (!jump) return undefined
  return {
    host: jump.host, port: jump.port, username: jump.username,
    authMethod: jump.auth_method as SSHJumpHost['authMethod'], keyId: jump.key_id != null ? String(jump.key_id) : undefined,
  }
}

export function redactSSHJumpHost(jump?: SSHJumpHost): SSHJumpHost | undefined {
  if (!jump) return undefined
  return { ...jump, password: undefined }
}

export const APP_PASSWORD_MIN_CHARACTERS = 12
export const APP_PASSWORD_MAX_BYTES = 1024

export type AppPasswordValidationError =
  | ''
  | '应用密码至少需要 12 个字符'
  | '应用密码不能超过 1024 字节'

const utf8Encoder = new TextEncoder()

export function validateAppPassword(password: string, requireMinimum = true): AppPasswordValidationError {
  if (requireMinimum && Array.from(password).length < APP_PASSWORD_MIN_CHARACTERS) {
    return '应用密码至少需要 12 个字符'
  }
  if (utf8Encoder.encode(password).byteLength > APP_PASSWORD_MAX_BYTES) {
    return '应用密码不能超过 1024 字节'
  }
  return ''
}

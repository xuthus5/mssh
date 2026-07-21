import type { AssetColorToken } from '@/lib/sessionModels'
import { t } from '@/i18n'


export const ASSET_COLOR_OPTIONS: { value: AssetColorToken; label: string }[] = [
  ['slate', t('灰色')], ['red', t('红色')], ['orange', t('橙色')], ['amber', t('琥珀')],
  ['yellow', t('黄色')], ['lime', t('青柠')], ['green', t('绿色')], ['teal', t('蓝绿')],
  ['cyan', t('青色')], ['blue', t('蓝色')], ['violet', t('紫色')], ['pink', t('粉色')],
].map(([value, label]) => ({ value: value as AssetColorToken, label }))

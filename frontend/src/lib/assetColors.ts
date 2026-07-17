import type { AssetColorToken } from '@/lib/sessionModels'

export const ASSET_COLOR_OPTIONS: { value: AssetColorToken; label: string }[] = [
  ['slate', '灰色'], ['red', '红色'], ['orange', '橙色'], ['amber', '琥珀'],
  ['yellow', '黄色'], ['lime', '青柠'], ['green', '绿色'], ['teal', '蓝绿'],
  ['cyan', '青色'], ['blue', '蓝色'], ['violet', '紫色'], ['pink', '粉色'],
].map(([value, label]) => ({ value: value as AssetColorToken, label }))

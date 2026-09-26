/**
 * The Wails native dialog bridge rejects instead of resolving empty when a picker is
 * dismissed, e.g. `Invalid dialog call: Dialog.SaveFile failed: error getting
 * selection: cancelled by user`. Dismissing a picker is a user decision, not a
 * failure, so callers treat this as a no-op instead of an error banner.
 */
export function isNativeDialogCancellation(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error)
  return /cancel+ed by user/i.test(message)
}

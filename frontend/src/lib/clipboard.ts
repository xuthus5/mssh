import { Clipboard as WailsClipboard } from '@wailsio/runtime'

export interface ClipboardPort {
  readText: () => Promise<string>
  writeText: (text: string) => Promise<void>
}

function browserClipboard(): ClipboardPort | null {
  const clipboard = globalThis.navigator?.clipboard
  if (!clipboard) return null
  return { readText: () => clipboard.readText(), writeText: (text) => clipboard.writeText(text) }
}

export function getClipboard(): ClipboardPort {
  const browser = browserClipboard()
  return {
    readText: async () => {
      try { return await WailsClipboard.Text() }
      catch (nativeError) { if (browser) return browser.readText(); throw nativeError }
    },
    writeText: async (text) => {
      try { await WailsClipboard.SetText(text) }
      catch (nativeError) { if (browser) { await browser.writeText(text); return }; throw nativeError }
    },
  }
}

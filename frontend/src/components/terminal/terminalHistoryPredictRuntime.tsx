import type { IDecoration, Terminal } from '@xterm/xterm'
import { createRoot, type Root } from 'react-dom/client'
import { TerminalSuggestionOverlay } from '@/components/terminal/TerminalSuggestionOverlay'
import { predictCommandTokens, readSessionCommands, splitCommandTokens } from '@/lib/commandHistoryPredict'
import { useTerminalBehaviorStore } from '@/store/terminalBehaviorStore'

export interface HistoryPredictHandlers {
  dispose: () => void
  update: () => void
}

export interface TokenPredictOptions {
  getSessionId: () => number | null | undefined
  getBuffer: () => string
  applyCompletion: (data: string) => void
  isEnabled?: () => boolean
}

interface PredictState {
  candidates: string[]
  selected: number
  open: boolean
  replacePartial: boolean
  pendingReopen: boolean
}

const MAX_LIST_ROWS = 8

function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey
}

/** Data to write into the terminal so `token` is inserted at the cursor. */
export function tokenInsertion(buffer: string, token: string, replacePartial: boolean): string {
  if (replacePartial) {
    const partial = splitCommandTokens(buffer).at(-1) ?? ''
    return `${token.slice(partial.length)} `
  }
  if (buffer.length === 0 || /\s$/.test(buffer)) return `${token} `
  return ` ${token} `
}

/** Ghost text to render after the cursor for the given suggestion. */
export function inlineSuggestionText(buffer: string, token: string, replacePartial: boolean): string {
  if (replacePartial) {
    const partial = splitCommandTokens(buffer).at(-1) ?? ''
    return token.slice(partial.length)
  }
  if (buffer.length === 0 || /\s$/.test(buffer)) return token
  return ` ${token}`
}

interface OverlayAnchor {
  sync: () => boolean
  dispose: () => void
}

/** Keeps a xterm decoration anchored to the current cursor cell. */
function createOverlayAnchor(term: Terminal, onRendered: (element: HTMLElement) => void): OverlayAnchor {
  let decoration: IDecoration | undefined
  let anchorKey = ''

  const show = () => {
    const active = term.buffer.active
    const marker = term.registerMarker(0)
    if (!marker) return false
    const next = term.registerDecoration({ marker, x: active.cursorX, width: 1, height: 1 })
    if (!next) {
      marker.dispose()
      return false
    }
    decoration = next
    next.onRender(onRendered)
    return true
  }

  return {
    sync: () => {
      const active = term.buffer.active
      const key = `${active.baseY}:${active.cursorY}:${active.cursorX}`
      if (key === anchorKey) return true
      anchorKey = key
      decoration?.dispose()
      decoration = undefined
      return show()
    },
    dispose: () => {
      decoration?.dispose()
      decoration = undefined
      anchorKey = ''
    },
  }
}

/** Token-level history prediction: inline ghost + Tab-expandable candidate list. */
class TokenPredictController {
  private state: PredictState = { candidates: [], selected: 0, open: false, replacePartial: false, pendingReopen: false }
  private root: Root | null = null
  private element: HTMLElement | null = null
  private overlay: OverlayAnchor

  constructor(private term: Terminal, private options: TokenPredictOptions) {
    this.overlay = createOverlayAnchor(term, (rendered) => {
      this.element = rendered
      this.renderOverlay()
    })
    term.attachCustomKeyEventHandler((event) => this.handleKeydown(event))
  }

  update() {
    this.refresh()
  }

  dispose() {
    this.term.attachCustomKeyEventHandler(() => true)
    this.hideOverlay()
  }

  private enabled(): boolean {
    if (this.options.isEnabled) return this.options.isEnabled()
    return useTerminalBehaviorStore.getState().historyPredict
  }

  private refresh() {
    if (!this.enabled() || this.options.getSessionId() === null || this.options.getSessionId() === undefined) {
      this.hideOverlay()
      return
    }
    const sessionID = this.options.getSessionId() as number
    const prediction = predictCommandTokens(this.options.getBuffer(), readSessionCommands(sessionID))
    this.state.candidates = prediction.tokens
    this.state.replacePartial = prediction.mode === 'prefix'
    if (this.state.candidates.length === 0) {
      this.state.open = false
      this.hideOverlay()
      return
    }
    if (this.state.pendingReopen) {
      this.state.open = true
      this.state.pendingReopen = false
    }
    this.state.selected = Math.min(this.state.selected, this.state.candidates.length - 1)
    this.renderOverlay()
  }

  private renderOverlay() {
    if (!this.overlay.sync()) return
    if (!this.element) return
    if (!this.root) this.root = createRoot(this.element)
    const buffer = this.options.getBuffer()
    const token = this.state.candidates[0] ?? ''
    this.root.render(
      <TerminalSuggestionOverlay
        inline={this.state.open ? '' : inlineSuggestionText(buffer, token, this.state.replacePartial)}
        candidates={this.state.open ? this.state.candidates : []}
        selectedIndex={this.state.selected}
        showAbove={this.term.buffer.active.cursorY >= this.term.rows - MAX_LIST_ROWS}
        onSelect={(index) => this.acceptToken(index)}
      />,
    )
  }

  private hideOverlay() {
    this.overlay.dispose()
    this.element = null
    if (this.root) {
      this.root.unmount()
      this.root = null
    }
  }

  private acceptToken(index: number) {
    const token = this.state.candidates[index]
    if (!token) return
    this.options.applyCompletion(tokenInsertion(this.options.getBuffer(), token, this.state.replacePartial))
    this.state.selected = 0
    this.state.pendingReopen = true
    this.refresh()
  }

  private handleKeydown(event: KeyboardEvent): boolean {
    if (event.type !== 'keydown' || !this.enabled()) return true
    if (isPlainKey(event) && event.key === 'Tab') {
      if (this.state.open) {
        event.preventDefault()
        this.state.selected = (this.state.selected + 1) % this.state.candidates.length
        this.renderOverlay()
        return false
      }
      if (this.state.candidates.length > 0) {
        event.preventDefault()
        this.acceptToken(0)
        return false
      }
      return true
    }
    if (this.state.open) {
      if (isPlainKey(event) && event.key === 'ArrowDown') {
        event.preventDefault()
        this.state.selected = Math.min(this.state.selected + 1, this.state.candidates.length - 1)
        this.renderOverlay()
        return false
      }
      if (isPlainKey(event) && event.key === 'ArrowUp') {
        event.preventDefault()
        this.state.selected = Math.max(this.state.selected - 1, 0)
        this.renderOverlay()
        return false
      }
      if (isPlainKey(event) && event.key === 'Enter') {
        event.preventDefault()
        this.acceptToken(this.state.selected)
        return false
      }
      if (isPlainKey(event) && event.key === 'Escape') {
        event.preventDefault()
        this.state.open = false
        this.renderOverlay()
        return false
      }
    }
    return true
  }
}

export function installCommandTokenPredict(term: Terminal, options: TokenPredictOptions): HistoryPredictHandlers {
  const controller = new TokenPredictController(term, options)
  return {
    dispose: () => controller.dispose(),
    update: () => controller.update(),
  }
}

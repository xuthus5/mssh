import { create } from 'zustand'
import { Terminal } from '@xterm/xterm'
import { initialNavigationState, type ActiveSurface, type OverviewSection, type WorkspaceID } from '@/store/tabNavigation'
import { createNavigationActions, createPoolActions, createStatusActions, createTabActions, createTransferActions } from '@/store/appStoreActions'
import { t } from '@/i18n'

export interface TerminalTab {
  id: string
  title: string
  type: 'terminal'
  terminalId: string
  sessionId: number
  /** Connection backend. Defaults to ssh when omitted. */
  connectionKind?: 'ssh' | 'serial' | 'local'
  /** Serial profile id when connectionKind is serial. */
  serialPortId?: number
  terminalInstance?: number
  toolPanel?: 'files' | 'history' | 'system' | 'ai' | null
  /** Durable split topology (roles only); runtime terminal IDs stay out of persistence. */
  splitLayout?: import('@/components/terminal/splitLayout').SplitLayoutSnapshot | null
  /** Live secondary/primary terminal IDs currently mounted in this tab's split tree. */
  splitPaneIDs?: string[]
}

export interface PlaybackTab {
  id: string
  title: string
  type: 'playback'
  recordingPath: string
}

export type Tab = TerminalTab | PlaybackTab
export interface PooledTerminal {
  terminal: Terminal
  lastUsed: number
}
export interface TransferJob {
  id: string
  fileName: string
  direction: 'upload' | 'download'
  sessionId: number
  sessionName: string
  sourcePath: string
  targetPath: string
  totalBytes: number
  transferredBytes: number
  speed: number
  eta: number
  status: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  error?: string
  startedAt: number
  completedAt?: number
}
export interface TerminalTheme {
  background: string
  foreground: string
  cursor: string
  cursorAccent: string
  selectionBackground: string
  cursorStyle: 'block' | 'underline' | 'bar'
  fontFamily: string
  fontSize: number
  ansiBlack: string
  ansiRed: string
  ansiGreen: string
  ansiYellow: string
  ansiBlue: string
  ansiMagenta: string
  ansiCyan: string
  ansiWhite: string
  ansiBrightBlack: string
  ansiBrightRed: string
  ansiBrightGreen: string
  ansiBrightYellow: string
  ansiBrightBlue: string
  ansiBrightMagenta: string
  ansiBrightCyan: string
  ansiBrightWhite: string
}
export type ConnectionStatus = 'connecting' | 'connected' | 'reconnecting' | 'closing' | 'disconnected' | 'error'

const DEFAULT_THEME: TerminalTheme = {
  background: '#0d1117',
  foreground: '#c9d1d9',
  cursor: '#c9d1d9',
  cursorAccent: '#0d1117',
  selectionBackground: '#264f78',
  cursorStyle: 'bar',
  fontFamily: '"JetBrains Mono", "Cascadia Code", monospace',
  fontSize: 14,
  ansiBlack: '#000000',
  ansiRed: '#cd0000',
  ansiGreen: '#00cd00',
  ansiYellow: '#cdcd00',
  ansiBlue: '#0000ee',
  ansiMagenta: '#cd00cd',
  ansiCyan: '#00cdcd',
  ansiWhite: '#e5e5e5',
  ansiBrightBlack: '#7f7f7f',
  ansiBrightRed: '#ff0000',
  ansiBrightGreen: '#00ff00',
  ansiBrightYellow: '#ffff00',
  ansiBrightBlue: '#5c5cff',
  ansiBrightMagenta: '#ff00ff',
  ansiBrightCyan: '#00ffff',
  ansiBrightWhite: '#ffffff',
}
export interface AppState {
  tabs: Tab[]
  activeSurface: ActiveSurface | null
  workspaceTab: WorkspaceID
  overviewSection: OverviewSection
  overviewReturnSurface: ActiveSurface | null
  navigationCollapsed: boolean
  sidebarWidth: number
  focusRequest: { id: string; terminalId?: string | null; sequence: number }
  terminalPool: Map<string, PooledTerminal>
  maxPoolSize: number
  connectionStatus: Record<string, ConnectionStatus>
  appStatus: string
  terminalTheme: TerminalTheme
  transfers: TransferJob[]
  transfersLoadError: string
  transferCenterOpen: boolean
  workspaceRestoreError: string
  workspaceRestoreNotice: string
  workspaceRestoreNonce: number
  workspaceSaveError: string
  activePaneId: string | null
  recordingState: Record<string, 'idle' | 'starting' | 'recording' | 'stopping' | 'error'>
  tunnelState: Record<string, 'running' | 'stopped'>
  addTransfer: (job: TransferJob) => void
  removeTransfer: (id: string) => void
  updateTransfer: (id: string, updates: Partial<Pick<TransferJob, 'transferredBytes' | 'speed' | 'totalBytes' | 'eta' | 'status' | 'error' | 'completedAt'>>) => void
  clearFinishedTransfers: () => void
  setTransfersLoadError: (error: string) => void
  setTransferCenterOpen: (open: boolean) => void
  setWorkspaceRestoreError: (error: string) => void
  setWorkspaceRestoreNotice: (notice: string) => void
  setWorkspaceSaveError: (error: string) => void
  retryWorkspaceRestore: () => void
  openTab: (tab: Tab) => void
  closeTab: (id: string) => Promise<void>
  removeTabLocal: (id: string) => void
  replaceTerminalConnection: (tabID: string, previousTerminalID: string, nextTerminalID: string) => boolean
  promoteTerminalConnection: (tabID: string, previousTerminalID: string, nextTerminalID: string) => boolean
  updateTerminalWorkspace: (tabID: string, updates: Pick<Partial<TerminalTab>, 'toolPanel' | 'splitLayout' | 'splitPaneIDs'>) => void
  activateWorkspace: (id: WorkspaceID) => void
  setOverviewSection: (section: OverviewSection) => void
  leaveOverview: () => void
  activateTab: (id: string, focus?: boolean) => void
  requestTerminalFocus: (tabID: string, terminalID: string) => void
  toggleNavigation: () => void
  setSidebarWidth: (width: number) => void
  registerTerminal: (id: string, terminal: Terminal) => void
  unregisterTerminal: (id: string) => void
  forgetTerminal: (id: string) => void
  updateLastUsed: (id: string) => void
  evictLRU: () => void
  setConnectionStatus: (id: string, status: ConnectionStatus) => void
  setActivePane: (id: string | null) => void
  setRecordingState: (id: string, state: AppState['recordingState'][string]) => void
  setTunnelState: (id: string, state: AppState['tunnelState'][string]) => void
  setAppStatus: (status: string) => void
  setTerminalTheme: (theme: TerminalTheme) => void
  setMaxPoolSize: (size: number) => void
}
const DEFAULT_MAX_POOL_SIZE = 32
const initialNavigation = initialNavigationState()

export const useAppStore = create<AppState>((set, get) => ({
  tabs: [],
  activeSurface: null,
  workspaceTab: 'sessions',
  overviewSection: 'sessions',
  overviewReturnSurface: null,
  ...initialNavigation,
  focusRequest: { id: '', terminalId: null, sequence: 0 },
  terminalPool: new Map(),
  maxPoolSize: DEFAULT_MAX_POOL_SIZE,
  connectionStatus: {},
  appStatus: t('就绪'),
  terminalTheme: DEFAULT_THEME,
  transfers: [],
  transfersLoadError: '',
  transferCenterOpen: false,
  workspaceRestoreError: '',
  workspaceRestoreNotice: '',
  workspaceRestoreNonce: 0,
  workspaceSaveError: '',
  activePaneId: null,
  recordingState: {},
  tunnelState: {},

  ...createTransferActions(set),
  ...createTabActions(set, get),
  ...createNavigationActions(set, get),
  ...createPoolActions(set, get),
  ...createStatusActions(set),
}))

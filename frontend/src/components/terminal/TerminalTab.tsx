import { useCallback, useEffect, useRef, useState } from 'react'
import { TerminalSplit, type TerminalSplitHandle } from '@/components/terminal/TerminalSplit'
import { TerminalToolbar } from '@/components/terminal/TerminalToolbar'
import { useAppStore, type TerminalTab as TerminalTabState } from '@/store/appStore'
import { LogService, TerminalService } from '@/lib/wails'
import { logger } from '@/lib/logger'
import type { TerminalFocusRequest } from '@/hooks/useTerminal'
import { CommandHistoryPanel } from '@/components/terminal/CommandHistoryPanel'
import { SystemPanel } from '@/components/terminal/SystemPanel'
import { TerminalSearchBar } from '@/components/terminal/TerminalSearchBar'
import { TerminalComposePanel } from '@/components/terminal/TerminalComposePanel'
import { AITerminalPanel } from '@/components/terminal/AITerminalPanel'
import { localHistoryBucket } from '@/hooks/terminalInputRuntime'
import { terminalConnectionLabel } from '@/lib/terminalTabs'
import { t } from '@/i18n'
import { TERMINAL_SEARCH_TOGGLE_EVENT } from '@/lib/terminalSearchEvents'


interface Props {
  terminalID: string
  sessionId: number
  onOpenFiles: (terminalID: string) => void
  active: boolean
  focusRequest: TerminalFocusRequest
  onPaneClosed?: (terminalID: string) => void
  onPaneReplaced?: (previousID: string, nextID: string) => void
  onCloseTerminal?: () => void
}

function useRecordingRuntime(terminalID: string, sessionId: number, setActionError: (error: string) => void) {
  const lifecycle = useRef(0)
  const requestID = useRef(0)
  const active = useRef(false)
  const visibleTarget = useRef({ terminalID, sessionId })
  visibleTarget.current = { terminalID, sessionId }
  useEffect(() => {
    const token = ++lifecycle.current
    return () => { if (lifecycle.current === token) { lifecycle.current++; requestID.current++ } }
  }, [])
  useEffect(() => { setActionError('') }, [sessionId, setActionError, terminalID])
  return { lifecycle, requestID, active, visibleTarget }
}

type RecordingRuntime = ReturnType<typeof useRecordingRuntime>

function beginRecordingRequest(runtime: RecordingRuntime, setBusy: (busy: boolean) => void) {
  runtime.active.current = true
  setBusy(true)
  return { lifecycleToken: runtime.lifecycle.current, request: ++runtime.requestID.current }
}

function finishRecordingRequest(runtime: RecordingRuntime, request: number, setBusy: (busy: boolean) => void) {
  if (runtime.requestID.current !== request) return
  runtime.active.current = false
  setBusy(false)
}

function useRecordingControl(terminalID: string, sessionId: number) {
  const recordingState = useAppStore((state) => state.recordingState[terminalID] ?? 'idle')
  const setRecordingState = useAppStore((state) => state.setRecordingState)
  const [actionError, setActionError] = useState('')
  const [operationBusy, setOperationBusy] = useState(false)
  const runtime = useRecordingRuntime(terminalID, sessionId, setActionError)
  const isRecording = recordingState === 'recording' || recordingState === 'stopping'
  const recordingBusy = operationBusy || recordingState === 'starting' || recordingState === 'stopping'
  const toggle = useCallback(async () => {
    if (sessionId === 0 || runtime.active.current) return
    const [targetTerminalID, targetSessionID] = [terminalID, sessionId]
    const { lifecycleToken, request } = beginRecordingRequest(runtime, setOperationBusy)
    const isOperationCurrent = () => runtime.lifecycle.current === lifecycleToken
      && runtime.requestID.current === request
      && useAppStore.getState().terminalPool.has(targetTerminalID)
    const isVisible = () => runtime.visibleTarget.current.terminalID === targetTerminalID && runtime.visibleTarget.current.sessionId === targetSessionID
    setActionError('')
    if (isRecording) {
      setRecordingState(targetTerminalID, 'stopping')
      try {
        await LogService.StopTerminalRecording(targetTerminalID)
        if (isOperationCurrent()) setRecordingState(targetTerminalID, 'idle')
      } catch (error: unknown) {
        logger.error('TerminalTab: stop recording failed:', error)
        if (isOperationCurrent()) {
          setRecordingState(targetTerminalID, 'error')
          if (isVisible()) setActionError(t('停止录制失败: ${}', error instanceof Error ? error.message : String(error)))
        }
      }
      finishRecordingRequest(runtime, request, setOperationBusy)
      return
    }
    setRecordingState(targetTerminalID, 'starting')
    const terminal = useAppStore.getState().terminalPool.get(targetTerminalID)?.terminal
    try {
      await LogService.StartTerminalRecording(targetTerminalID, targetSessionID, terminal?.cols ?? 80, terminal?.rows ?? 24, 'xterm-256color')
      if (isOperationCurrent()) setRecordingState(targetTerminalID, 'recording')
    } catch (error: unknown) {
      logger.error('TerminalTab: start recording failed:', error)
      if (isOperationCurrent()) {
        setRecordingState(targetTerminalID, 'error')
        if (isVisible()) setActionError(t('开始录制失败: ${}', error instanceof Error ? error.message : String(error)))
      }
    } finally {
      finishRecordingRequest(runtime, request, setOperationBusy)
    }
  }, [isRecording, runtime, sessionId, setRecordingState, terminalID])
  return { isRecording, recordingBusy, toggle, actionError }
}

function useTerminalTabController(props: Props) {
  const { terminalID, sessionId, active } = props
  const tabs = useAppStore((state) => state.tabs)
  const activePaneID = useAppStore((state) => state.activePaneId)
  const updateTerminalWorkspace = useAppStore((state) => state.updateTerminalWorkspace)
  const currentTab = tabs.find((tab): tab is TerminalTabState => tab.type === 'terminal' && tab.terminalId === terminalID)
  const toolPanel = currentTab?.toolPanel ?? null
  const connectionKind = currentTab?.connectionKind ?? 'ssh'
  const remoteFeatures = connectionKind === 'ssh'
  const historySessionId = connectionKind === 'serial'
    ? -(currentTab?.serialPortId ?? 0)
    : connectionKind === 'local'
      ? localHistoryBucket(currentTab?.terminalInstance)
      : sessionId
  const recordingSessionId = remoteFeatures ? sessionId : 0
  const splitRef = useRef<TerminalSplitHandle>(null)
  const [splitState, setSplitState] = useState({ paneCount: 1, busy: false })
  const [searchOpen, setSearchOpen] = useState(false)
  const [composeOpen, setComposeOpen] = useState(false)
  useEffect(() => {
    if (!active) return
    const onToggle = () => setSearchOpen((value) => !value)
    window.addEventListener(TERMINAL_SEARCH_TOGGLE_EVENT, onToggle)
    return () => window.removeEventListener(TERMINAL_SEARCH_TOGGLE_EVENT, onToggle)
  }, [active])
  const activeTerminalID = activePaneID ?? terminalID
  const updateWorkspace = useCallback((updates: Parameters<typeof updateTerminalWorkspace>[1]) => {
    if (currentTab) updateTerminalWorkspace(currentTab.id, updates)
  }, [currentTab, updateTerminalWorkspace])
  const recording = useRecordingControl(activeTerminalID, recordingSessionId)
  return {
    props, currentTab, toolPanel, connectionKind, remoteFeatures, historySessionId,
    splitRef, splitState, setSplitState, searchOpen, setSearchOpen, composeOpen, setComposeOpen,
    activeTerminalID, updateWorkspace, recording,
  }
}

type TerminalTabController = ReturnType<typeof useTerminalTabController>

function TerminalToolPanels({ controller }: { controller: TerminalTabController }) {
  const { props, toolPanel, remoteFeatures, historySessionId, activeTerminalID, searchOpen, setSearchOpen, updateWorkspace } = controller
  const aiVisited = useRef(false)
  if (toolPanel === 'ai') aiVisited.current = true
  const closePanel = () => updateWorkspace({ toolPanel: null })
  const fillCommand = (command: string) => {
    const terminal = useAppStore.getState().terminalPool.get(activeTerminalID)?.terminal
    terminal?.paste(command)
    terminal?.focus()
  }
  const executeCommand = async (command: string) => {
    const input = /[\r\n]$/.test(command) ? command : `${command}\r`
    await TerminalService.Write(activeTerminalID, input)
    useAppStore.getState().terminalPool.get(activeTerminalID)?.terminal?.focus()
  }
  return <>
    <TerminalSearchBar terminalID={activeTerminalID} open={searchOpen} onOpenChange={setSearchOpen} />
    {toolPanel === 'history' && historySessionId !== 0
      ? <CommandHistoryPanel sessionID={historySessionId} onClose={closePanel} onExecute={executeCommand} onFill={fillCommand} />
      : null}
    {toolPanel === 'system' && remoteFeatures
      ? <SystemPanel terminalID={activeTerminalID} onClose={closePanel} />
      : null}
    {aiVisited.current && remoteFeatures
      ? <AITerminalPanel open={toolPanel === 'ai'} terminalID={activeTerminalID} sessionID={props.sessionId} onClose={closePanel} />
      : null}
  </>
}

function TerminalWorkspace({ controller }: { controller: TerminalTabController }) {
  const { props, currentTab, connectionKind, splitRef, setSplitState } = controller
  return <div className="relative min-h-0 flex-1">
    {currentTab ? <TerminalSplit
      ref={splitRef}
      tabID={currentTab.id}
      primaryID={props.terminalID}
      sessionId={props.sessionId}
      connectionKind={connectionKind}
      serialPortId={currentTab.serialPortId}
      active={props.active}
      focusRequest={props.focusRequest}
      onStateChange={setSplitState}
      onPaneClosed={props.onPaneClosed}
      onPaneReplaced={props.onPaneReplaced}
      onCloseTerminal={props.onCloseTerminal}
    /> : null}
    <TerminalToolPanels controller={controller} />
  </div>
}

function TerminalTabView({ controller }: { controller: TerminalTabController }) {
  const { props, currentTab, toolPanel, connectionKind, remoteFeatures, splitRef, splitState,
    setSplitState, searchOpen, setSearchOpen, composeOpen, setComposeOpen, activeTerminalID,
    updateWorkspace, recording } = controller
  const toolbarLabel = terminalConnectionLabel(currentTab) ?? currentTab?.title
  return (
    <div className="flex h-full min-h-0 flex-col">
      <TerminalToolbar
        terminalID={activeTerminalID}
        sessionId={props.sessionId}
        isRecording={recording.isRecording}
        recordingBusy={recording.recordingBusy}
        recordingLogId={null}
        recordingError={recording.actionError}
        onToggleRecording={recording.toggle}
        connectionLabel={toolbarLabel}
        filesSupported={remoteFeatures}
        serialControls={connectionKind === 'serial'}
        onOpenFiles={remoteFeatures ? () => props.onOpenFiles(activeTerminalID) : undefined}
        onSplit={(direction) => splitRef.current?.split(direction)}
        splitDisabled={splitState.busy || splitState.paneCount >= 8 || connectionKind === 'serial'}
        paneCount={splitState.paneCount}
        searchOpen={searchOpen}
        onToggleSearch={() => setSearchOpen((value) => !value)}
        composeOpen={composeOpen}
        onToggleCompose={() => setComposeOpen((value) => !value)}
        onOpenHistory={() => updateWorkspace({ toolPanel: toolPanel === 'history' ? null : 'history' })}
        onOpenSystem={remoteFeatures ? () => updateWorkspace({ toolPanel: toolPanel === 'system' ? null : 'system' }) : undefined}
        onOpenAI={remoteFeatures ? () => updateWorkspace({ toolPanel: toolPanel === 'ai' ? null : 'ai' }) : undefined}
      />
      <TerminalWorkspace controller={controller} />
      <TerminalComposePanel open={composeOpen} terminalID={activeTerminalID} sessionID={props.sessionId} onClose={() => setComposeOpen(false)} />
    </div>
  )
}

export function TerminalTab(props: Props) {
  return <TerminalTabView controller={useTerminalTabController(props)} />
}

import { create } from 'zustand'

interface TerminalDirectoryState {
  directories: Record<string, string>
  revisions: Record<string, number>
  setDirectory: (terminalID: string, path: string) => void
  clearDirectory: (terminalID: string) => void
}

export const useTerminalDirectoryStore = create<TerminalDirectoryState>((set) => ({
  directories: {},
  revisions: {},
  setDirectory: (terminalID, path) => set((state) => ({
    directories: { ...state.directories, [terminalID]: path },
    revisions: { ...state.revisions, [terminalID]: (state.revisions[terminalID] ?? 0) + 1 },
  })),
  clearDirectory: (terminalID) => set((state) => {
    const directories = { ...state.directories }
    const revisions = { ...state.revisions }
    delete directories[terminalID]
    delete revisions[terminalID]
    return { directories, revisions }
  }),
}))

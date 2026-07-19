import { create } from 'zustand'

interface TerminalDirectoryState {
  directories: Record<string, string>
  setDirectory: (terminalID: string, path: string) => void
  clearDirectory: (terminalID: string) => void
}

export const useTerminalDirectoryStore = create<TerminalDirectoryState>((set) => ({
  directories: {},
  setDirectory: (terminalID, path) => set((state) => ({ directories: { ...state.directories, [terminalID]: path } })),
  clearDirectory: (terminalID) => set((state) => {
    const directories = { ...state.directories }
    delete directories[terminalID]
    return { directories }
  }),
}))

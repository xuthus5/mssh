export const OPEN_AI_AGENT_CENTER_EVENT = 'mssh:open-ai-agent-center'

export interface AIAgentCenterTarget {
  sessionID?: number
  sessionName?: string
}

export function openAIAgentCenter(target: AIAgentCenterTarget = {}) {
  window.dispatchEvent(new CustomEvent(OPEN_AI_AGENT_CENTER_EVENT, { detail: target }))
}

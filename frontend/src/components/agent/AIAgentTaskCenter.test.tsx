import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it } from 'vitest'
import { AIAgentTaskCenter } from '@/components/agent/AIAgentTaskCenter'
import { openAIAgentCenter } from '@/lib/aiAgentEvents'
import { __clearHandlers, __registerHandler } from '@/test/__mocks__/wails-runtime'

const listCall = 'github.com/xuthus5/mssh/internal/service.AIService.ListAgentTasks'

describe('AIAgentTaskCenter', () => {
  beforeEach(() => {
    __clearHandlers()
    __registerHandler(listCall, async () => [])
  })

  it('opens globally and for a selected SSH session', async () => {
    render(<AIAgentTaskCenter />)
    openAIAgentCenter({ sessionID: 9, sessionName: 'prod' })
    expect(await screen.findByText('Agent 任务中心')).toBeInTheDocument()
    expect(screen.getByPlaceholderText('描述要在 prod 上完成的任务')).toBeInTheDocument()
  })
})

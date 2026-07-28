package service

type terminalOutputStage struct {
	remaining []byte
	flow      *terminalOutputFlow
	active    bool
	attached  bool
	wait      bool
}

func (t *TerminalService) stagePTYOutput(terminalID string, data []byte) terminalOutputStage {
	t.mu.Lock()
	defer t.mu.Unlock()
	if _, ok := t.ptys[terminalID]; !ok {
		return terminalOutputStage{}
	}
	flow := t.outputFlowLocked(terminalID)
	if t.attached[terminalID] {
		return terminalOutputStage{remaining: data, flow: flow, active: true, attached: true}
	}
	available := maxPendingTerminalOutput - len(t.pendingOutput[terminalID])
	if available > len(data) {
		available = len(data)
	}
	if available > 0 {
		t.pendingOutput[terminalID] = append(t.pendingOutput[terminalID], data[:available]...)
	}
	wait := len(t.pendingOutput[terminalID]) >= maxPendingTerminalOutput
	if wait {
		flow.pause()
	}
	return terminalOutputStage{
		remaining: data[available:], flow: flow, active: true, wait: wait,
	}
}

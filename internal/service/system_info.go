package service

import (
	"fmt"
	"strings"
	"time"

	"github.com/xuthus5/mssh/internal/model"
)

func (t *TerminalService) SystemInfo(terminalID string) (*model.SystemInfo, error) {
	if err := validateTerminalID(terminalID); err != nil {
		return nil, err
	}
	finish, err := t.beginOperation()
	if err != nil {
		return nil, err
	}
	defer finish()
	sessionID, ok := t.terminalSessionID(terminalID)
	if !ok {
		return nil, fmt.Errorf("terminal %s not found", terminalID)
	}
	wrapper, release, err := t.acquireSystemProbeConnection(sessionID)
	if err != nil {
		return nil, err
	}
	defer release()
	started := time.Now()
	output, err := _runSystemInfoCommand(wrapper, systemInfoCommand)
	if err != nil {
		return nil, err
	}
	info, sample, err := parseSystemInfo(strings.Fields(string(output)))
	if err != nil {
		return nil, err
	}
	info.LatencyMS = float64(time.Since(started).Microseconds()) / 1000
	t.updateSystemRates(terminalID, info, sample, time.Now())
	return info, nil
}

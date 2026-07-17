package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
	ssh "github.com/xuthus5/mssh/internal/ssh"
)

const (
	terminalOutputBudget = 500 * time.Millisecond
	monitorParsingBudget = 500 * time.Millisecond
)

type discardEventBus struct{}

func (discardEventBus) Emit(string, interface{}) {}

func TestRuntimePerformanceBudgets(t *testing.T) {
	service := NewTerminalService(nil, discardEventBus{}, 32, testutil.NewTestLogger())
	service.ptys["terminal"] = (*ssh.PTYSession)(nil)
	service.attached["terminal"] = true
	payload := make([]byte, 1024)
	started := time.Now()
	for range 10_000 {
		service.handlePTYOutput("terminal", payload)
	}
	require.Less(t, time.Since(started), terminalOutputBudget)

	values := sampleSystemInfoValues()
	started = time.Now()
	for range 10_000 {
		_, _, err := parseSystemInfo(values)
		require.NoError(t, err)
	}
	require.Less(t, time.Since(started), monitorParsingBudget)
}

func BenchmarkCommercialTerminalOutput1KiB(b *testing.B) {
	service := NewTerminalService(nil, discardEventBus{}, 32, testutil.NewTestLogger())
	service.ptys["terminal"] = (*ssh.PTYSession)(nil)
	service.attached["terminal"] = true
	payload := make([]byte, 1024)
	b.ResetTimer()
	for range b.N {
		service.handlePTYOutput("terminal", payload)
	}
}

func BenchmarkCommercialMonitorParsing(b *testing.B) {
	values := sampleSystemInfoValues()
	b.ResetTimer()
	for range b.N {
		if _, _, err := parseSystemInfo(values); err != nil {
			b.Fatal(err)
		}
	}
}

func sampleSystemInfoValues() []string {
	return []string{"LOAD", "0.1", "0.2", "0.3", "UPTIME", "3600", "KERNEL", "6.12", "OS", "Linux", "CPU", "1000", "200", "MEMTOTAL", "8589934592", "MEMAVAILABLE", "4294967296", "SWAPTOTAL", "2147483648", "SWAPFREE", "1073741824", "NET", "100000", "50000", "DISK", "1000000", "2000000", "CPUCOUNT", "4"}
}

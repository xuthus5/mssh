package service

import (
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

type lruRacePTY struct{}

func (lruRacePTY) Write(data []byte) (int, error) { return len(data), nil }

func (lruRacePTY) Resize(int, int) error { return nil }

func (lruRacePTY) Close() error { return nil }

func (lruRacePTY) SetReadCallback(func([]byte)) {}

func (lruRacePTY) SetExitCallback(func(error)) {}

func (lruRacePTY) Start() {}

func TestTerminalServiceLRUEvictionIgnoresOrphanTimestamp(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	service.ptys["active"] = lruRacePTY{}
	service.lastUsed["active"] = time.Now()
	service.lastUsed["orphan"] = time.Now().Add(-time.Hour)

	service.registerTerminal("new", "", 0, lruRacePTY{})

	require.Equal(t, 1, service.Count())
	assert.NotContains(t, service.ptys, "active")
	assert.Contains(t, service.ptys, "new")
	assert.NotContains(t, service.lastUsed, "orphan")
}

func TestTerminalServicePickLRUVictimSerializesOrphanCleanup(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	service.ptys["active"] = lruRacePTY{}
	service.lastUsed["active"] = time.Now()
	for index := range 256 {
		service.lastUsed[fmt.Sprintf("orphan-%d", index)] = time.Now().Add(-time.Hour)
	}

	start := make(chan struct{})
	results := make(chan string, 16)
	var waitGroup sync.WaitGroup
	for range 16 {
		waitGroup.Add(1)
		go func() {
			defer waitGroup.Done()
			<-start
			results <- service.pickLRUVictim()
		}()
	}
	close(start)
	waitGroup.Wait()
	close(results)

	for result := range results {
		assert.Equal(t, "active", result)
	}
	assert.Equal(t, map[string]time.Time{"active": service.lastUsed["active"]}, service.lastUsed)
}

func TestTerminalServiceTerminalForActivityDoesNotReviveDetachedState(t *testing.T) {
	service := NewTerminalService(nil, newMockEventBus(), 1, testutil.NewTestLogger())
	service.ptys["active"] = lruRacePTY{}

	pty, ok := service.terminalForActivity("active")
	require.True(t, ok)
	assert.NotNil(t, pty)
	assert.Contains(t, service.lastUsed, "active")

	delete(service.ptys, "active")
	delete(service.lastUsed, "active")
	pty, ok = service.terminalForActivity("active")
	assert.False(t, ok)
	assert.Nil(t, pty)
	assert.NotContains(t, service.lastUsed, "active")
}

package event

import (
	"encoding/json"
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestEventConstants(t *testing.T) {
	assert.Equal(t, "terminal:output", TerminalOutput)
	assert.Equal(t, "terminal:closed", TerminalClosed)
	assert.Equal(t, "file:progress", TransferProgress)
	assert.Equal(t, "file:complete", TransferComplete)
	assert.Equal(t, "file:error", TransferError)
	assert.Equal(t, "session:state", ConnectionState)
	assert.Equal(t, "session:error", ConnectionError)
	assert.Equal(t, "tunnel:state", TunnelState)
}

func TestConstantsFollowNamingConvention(t *testing.T) {
	events := map[string]string{
		TerminalOutput:   "terminal:output",
		TerminalClosed:   "terminal:closed",
		TransferProgress: "file:progress",
		TransferComplete: "file:complete",
		TransferError:    "file:error",
		ConnectionState:  "session:state",
		ConnectionError:  "session:error",
		TunnelState:      "tunnel:state",
	}
	for _, v := range events {
		assert.Contains(t, v, ":")
	}
}

func TestTerminalOutputPayload_JSON(t *testing.T) {
	p := TerminalOutputPayload{TerminalID: "term-1", Data: []byte("hello")}
	data, err := json.Marshal(p)
	assert.NoError(t, err)

	var decoded TerminalOutputPayload
	err = json.Unmarshal(data, &decoded)
	assert.NoError(t, err)
	assert.Equal(t, p.TerminalID, decoded.TerminalID)
	assert.Equal(t, p.Data, decoded.Data)
}

func TestConnectionStatePayload_JSON(t *testing.T) {
	p := ConnectionStatePayload{TerminalID: "term-1", State: "connected"}
	data, err := json.Marshal(p)
	assert.NoError(t, err)
	assert.Contains(t, string(data), "terminal_id")
	assert.Contains(t, string(data), "state")

	var decoded ConnectionStatePayload
	err = json.Unmarshal(data, &decoded)
	assert.NoError(t, err)
	assert.Equal(t, p, decoded)
}

func TestTransferProgressPayload_JSON(t *testing.T) {
	p := TransferProgressPayload{TaskID: "task-1", Percent: 50.5, Speed: 1024, ETA: 60}
	data, err := json.Marshal(p)
	assert.NoError(t, err)
	assert.Contains(t, string(data), "task_id")
	assert.Contains(t, string(data), "percent")

	var decoded TransferProgressPayload
	err = json.Unmarshal(data, &decoded)
	assert.NoError(t, err)
	assert.Equal(t, p, decoded)
}

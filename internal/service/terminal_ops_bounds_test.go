package service

import (
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

type stubTerminalIO struct {
	writes [][]byte
	cols   int
	rows   int
}

func (s *stubTerminalIO) Write(data []byte) (int, error) {
	s.writes = append(s.writes, append([]byte(nil), data...))
	return len(data), nil
}

func (s *stubTerminalIO) Resize(cols, rows int) error {
	s.cols, s.rows = cols, rows
	return nil
}

func (s *stubTerminalIO) Close() error { return nil }

func (s *stubTerminalIO) SetReadCallback(func([]byte)) {}

func (s *stubTerminalIO) SetExitCallback(func(error)) {}

func (s *stubTerminalIO) Start() {}

func TestTerminalService_WriteRejectsOversizedPayload(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	payload := strings.Repeat("a", maxTerminalWriteBytes+1)
	_, err := svc.Write("term-1", payload)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "exceeds")
	assert.Empty(t, stub.writes)
}

func TestTerminalService_WriteRejectsInvalidUTF8(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	_, err := svc.Write("term-1", string([]byte{0xff, 0xfe}))
	require.Error(t, err)
	assert.Contains(t, err.Error(), "UTF-8")
	assert.Empty(t, stub.writes)
}

func TestTerminalService_WriteAcceptsBoundaryPayload(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	payload := strings.Repeat("b", maxTerminalWriteBytes)
	n, err := svc.Write("term-1", payload)
	require.NoError(t, err)
	assert.Equal(t, maxTerminalWriteBytes, n)
	require.Len(t, stub.writes, 1)
	assert.Len(t, stub.writes[0], maxTerminalWriteBytes)
}

func TestTerminalService_ResizeRejectsInvalidGeometry(t *testing.T) {
	stub := &stubTerminalIO{}
	svc := &TerminalService{
		logger:   testutil.NewTestLogger(),
		ptys:     map[string]terminalIO{"term-1": stub},
		lastUsed: map[string]time.Time{"term-1": time.Now()},
	}
	assert.Error(t, svc.Resize("term-1", 0, 24))
	assert.Error(t, svc.Resize("term-1", 80, 0))
	assert.Error(t, svc.Resize("term-1", maxTerminalCols+1, 24))
	assert.Error(t, svc.Resize("term-1", 80, maxTerminalRows+1))
	assert.Equal(t, 0, stub.cols)
	assert.Equal(t, 0, stub.rows)

	require.NoError(t, svc.Resize("term-1", maxTerminalCols, maxTerminalRows))
	assert.Equal(t, maxTerminalCols, stub.cols)
	assert.Equal(t, maxTerminalRows, stub.rows)
}

func TestTerminalService_OpenRejectsInvalidGeometry(t *testing.T) {
	svc := &TerminalService{logger: testutil.NewTestLogger()}
	_, err := svc.OpenLocal(t.Context(), 0, 24)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "cols")
}

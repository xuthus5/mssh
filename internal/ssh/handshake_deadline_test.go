package ssh

import (
	"context"
	"errors"
	"net"
	"os"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	gossh "golang.org/x/crypto/ssh"
)

type recordedHandshakeDeadline struct {
	deadline time.Time
	calledAt time.Time
}

type handshakeTestConn struct {
	net.Conn
	mu          sync.Mutex
	deadlines   []recordedHandshakeDeadline
	failAt      int
	deadlineErr error
}

func (c *handshakeTestConn) SetDeadline(deadline time.Time) error {
	c.mu.Lock()
	c.deadlines = append(c.deadlines, recordedHandshakeDeadline{deadline: deadline, calledAt: time.Now()})
	failed := len(c.deadlines) == c.failAt
	c.mu.Unlock()
	if failed {
		return c.deadlineErr
	}
	return c.Conn.SetDeadline(deadline)
}

func (c *handshakeTestConn) recordedDeadlines() []recordedHandshakeDeadline {
	c.mu.Lock()
	defer c.mu.Unlock()
	return append([]recordedHandshakeDeadline(nil), c.deadlines...)
}

func newHandshakePipe(t *testing.T) *handshakeTestConn {
	t.Helper()
	client, server := net.Pipe()
	t.Cleanup(func() { _ = client.Close(); _ = server.Close() })
	return &handshakeTestConn{Conn: client}
}

func TestHandshakeDeadlineRestoresRemainingNetworkBudget(t *testing.T) {
	conn := newHandshakePipe(t)
	budget := newHandshakeDeadline(t.Context(), conn, time.Second)
	require.NoError(t, budget.applyNetworkDeadline())
	time.Sleep(75 * time.Millisecond)
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error {
		records := conn.recordedDeadlines()
		assert.True(t, records[len(records)-1].deadline.IsZero())
		time.Sleep(30 * time.Millisecond)
		return nil
	})
	require.NoError(t, verify("server:22", nil, nil))
	records := conn.recordedDeadlines()
	require.Len(t, records, 3)
	paused := records[2].calledAt.Sub(records[1].calledAt)
	extension := records[2].deadline.Sub(records[0].deadline)
	assert.InDelta(t, float64(paused), float64(extension), float64(25*time.Millisecond))
}

func TestHandshakeDeadlinePreservesAbsoluteContextDeadline(t *testing.T) {
	conn := newHandshakePipe(t)
	contextDeadline := time.Now().Add(250 * time.Millisecond)
	ctx, cancel := context.WithDeadline(t.Context(), contextDeadline)
	t.Cleanup(cancel)
	budget := newHandshakeDeadline(ctx, conn, 100*time.Millisecond)
	require.NoError(t, budget.applyNetworkDeadline())
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error {
		assert.Equal(t, contextDeadline, conn.recordedDeadlines()[1].deadline)
		time.Sleep(180 * time.Millisecond)
		return nil
	})
	require.NoError(t, verify("server:22", nil, nil))
	records := conn.recordedDeadlines()
	require.Len(t, records, 3)
	assert.Equal(t, contextDeadline, records[2].deadline)
	deadline, applied := budget.stop()
	assert.Equal(t, contextDeadline, deadline)
	assert.True(t, applied)
}

func TestHandshakeDeadlineDoesNotRestartForRekey(t *testing.T) {
	conn := newHandshakePipe(t)
	ctx, cancel := context.WithCancel(t.Context())
	t.Cleanup(cancel)
	budget := newHandshakeDeadline(ctx, conn, time.Second)
	require.NoError(t, budget.applyNetworkDeadline())
	called := false
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error { called = true; return nil })
	budget.stop()
	require.NoError(t, conn.SetDeadline(time.Time{}))
	cancel()
	require.NoError(t, verify("server:22", nil, nil))
	assert.True(t, called)
	assert.Len(t, conn.recordedDeadlines(), 2)
}

func TestHandshakeDeadlineStopWhileVerificationIsPending(t *testing.T) {
	conn := newHandshakePipe(t)
	budget := newHandshakeDeadline(t.Context(), conn, time.Second)
	require.NoError(t, budget.applyNetworkDeadline())
	started := make(chan struct{})
	decision := make(chan struct{})
	var releaseOnce sync.Once
	release := func() { releaseOnce.Do(func() { close(decision) }) }
	t.Cleanup(release)
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error {
		close(started)
		<-decision
		return nil
	})
	result := make(chan error, 1)
	go func() { result <- verify("server:22", nil, nil) }()
	<-started
	stopped := make(chan struct{})
	go func() { budget.stop(); close(stopped) }()
	select {
	case <-stopped:
	case <-time.After(time.Second):
		t.Fatal("stopping the deadline waited for host key confirmation")
	}
	require.NoError(t, conn.SetDeadline(time.Time{}))
	release()
	require.NoError(t, <-result)
	assert.Len(t, conn.recordedDeadlines(), 3)
}

func TestHandshakeDeadlineRejectsExpiredNetworkBudget(t *testing.T) {
	conn := newHandshakePipe(t)
	budget := newHandshakeDeadline(t.Context(), conn, -time.Millisecond)
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error {
		t.Error("expired network budget must not request host key confirmation")
		return nil
	})
	require.ErrorIs(t, verify("server:22", nil, nil), os.ErrDeadlineExceeded)
	assert.Empty(t, conn.recordedDeadlines())
}

func TestHandshakeDeadlineRejectsCancelledContext(t *testing.T) {
	conn := newHandshakePipe(t)
	ctx, cancel := context.WithCancel(t.Context())
	cancel()
	budget := newHandshakeDeadline(ctx, conn, time.Second)
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error {
		t.Error("cancelled attempt must not request host key confirmation")
		return nil
	})
	require.ErrorIs(t, verify("server:22", nil, nil), context.Canceled)
	assert.Empty(t, conn.recordedDeadlines())
	assert.Nil(t, budget.wrapHostKeyCallback(nil))
}

func TestHandshakeDeadlinePreservesVerificationAndResumeErrors(t *testing.T) {
	conn := newHandshakePipe(t)
	conn.failAt = 3
	conn.deadlineErr = errors.New("resume failed")
	verificationErr := errors.New("host key rejected")
	budget := newHandshakeDeadline(t.Context(), conn, time.Second)
	require.NoError(t, budget.applyNetworkDeadline())
	verify := budget.wrapHostKeyCallback(func(_ string, _ net.Addr, _ gossh.PublicKey) error { return verificationErr })
	err := verify("server:22", nil, nil)
	require.ErrorIs(t, err, verificationErr)
	require.ErrorIs(t, err, conn.deadlineErr)
}

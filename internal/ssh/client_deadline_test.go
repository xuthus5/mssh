package ssh

import (
	"context"
	"errors"
	"net"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

type handshakeTimeoutError struct{}

func (handshakeTimeoutError) Error() string { return "i/o timeout" }

func (handshakeTimeoutError) Timeout() bool { return true }

func (handshakeTimeoutError) Temporary() bool { return true }

func TestClientWrapperSetDeadline(t *testing.T) {
	client, server := net.Pipe()
	defer func() { _ = client.Close() }()
	defer func() { _ = server.Close() }()
	wrapper := &ClientWrapper{transport: client}
	require.NoError(t, wrapper.SetDeadline(time.Now().Add(20*time.Millisecond)))
	_, err := client.Read(make([]byte, 1))
	require.Error(t, err)
	var networkError net.Error
	require.True(t, errors.As(err, &networkError))
	assert.True(t, networkError.Timeout())
}

func TestClientWrapperSetDeadlineRejectsUnavailableTransport(t *testing.T) {
	var wrapper *ClientWrapper
	assert.ErrorContains(t, wrapper.SetDeadline(time.Now()), "unavailable")
	assert.ErrorContains(t, (&ClientWrapper{}).SetDeadline(time.Now()), "unavailable")
}

func TestNormalizeHandshakeErrorMapsContextOwnedTimeout(t *testing.T) {
	err := normalizeHandshakeError(
		context.Background(),
		handshakeTimeoutError{},
		time.Now().Add(-time.Millisecond),
		true,
	)
	require.ErrorIs(t, err, context.DeadlineExceeded)
}

func TestNormalizeHandshakeErrorPreservesTransportTimeout(t *testing.T) {
	timeoutErr := handshakeTimeoutError{}
	err := normalizeHandshakeError(
		context.Background(),
		timeoutErr,
		time.Now().Add(-time.Millisecond),
		false,
	)
	require.Equal(t, timeoutErr, err)
}

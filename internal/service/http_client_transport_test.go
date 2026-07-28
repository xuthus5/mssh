package service

import (
	"context"
	"net"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestSecureHTTPTransportPreservesConfiguredDialer(t *testing.T) {
	called := false
	base := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) {
		called = true
		return nil, context.Canceled
	}}

	transport := secureHTTPTransport(base)
	_, err := transport.DialContext(context.Background(), "tcp", "127.0.0.1:443")
	require.ErrorIs(t, err, context.Canceled)
	assert.True(t, called)
}

func TestSecureHTTPTransportBlocksUnsafeTargetBeforeConfiguredDialer(t *testing.T) {
	called := false
	base := &http.Transport{DialContext: func(context.Context, string, string) (net.Conn, error) {
		called = true
		return nil, context.Canceled
	}}
	transport := secureHTTPTransport(base)

	_, err := transport.DialContext(context.Background(), "tcp", "169.254.169.254:80")

	require.Error(t, err)
	assert.Contains(t, err.Error(), "not allowed")
	assert.False(t, called)
}

func TestValidateConfiguredDialTargetRejectsInvalidInputs(t *testing.T) {
	tests := []struct {
		name, network, address string
	}{
		{name: "network", network: "udp", address: "example.com:80"},
		{name: "address", network: "tcp", address: "invalid"},
		{name: "metadata", network: "tcp", address: "metadata.google.internal:80"},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			assert.Error(t, validateConfiguredDialTarget(test.network, test.address))
		})
	}
	assert.NoError(t, validateConfiguredDialTarget("tcp6", "[::1]:443"))
}

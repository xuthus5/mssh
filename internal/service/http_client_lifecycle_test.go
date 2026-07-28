package service

import (
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/netproxy"
)

func TestSharedHTTPClientUsesManagedTransportGeneration(t *testing.T) {
	manager := netproxy.New()
	client := sharedHTTPClient(2*time.Second, manager)

	assert.Same(t, manager, client.Transport)
}

func TestSharedHTTPClientWithManagerRetainsBlockedDialPolicy(t *testing.T) {
	manager := netproxy.New()
	require.NoError(t, manager.Configure(netproxy.Config{Mode: netproxy.ModeDirect}))
	client := sharedHTTPClient(2*time.Second, manager)
	request, err := http.NewRequestWithContext(t.Context(), http.MethodGet, "http://169.254.169.254/latest", nil)
	require.NoError(t, err)

	response, err := client.Do(request)
	if response != nil {
		_ = response.Body.Close()
	}
	require.Error(t, err)
	assert.ErrorContains(t, err, "not allowed")
}

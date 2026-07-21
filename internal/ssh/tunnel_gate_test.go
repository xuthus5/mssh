package ssh

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestTunnelConnGateLimitsConcurrency(t *testing.T) {
	gate := &tunnelConnGate{}
	for i := 0; i < maxTunnelForwardConns; i++ {
		assert.True(t, gate.tryAcquire())
	}
	assert.False(t, gate.tryAcquire())
	gate.release()
	assert.True(t, gate.tryAcquire())
}

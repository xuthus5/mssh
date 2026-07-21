package ssh

import (
	"testing"

	"github.com/stretchr/testify/assert"
)

func TestPTYSessionPendingReadBounded(t *testing.T) {
	p := &PTYSession{}
	chunk := make([]byte, 300_000)
	for i := 0; i < 10; i++ {
		p.deliverRead(chunk)
	}
	assert.LessOrEqual(t, len(p.pendingRead), maxPendingRead)
	assert.Equal(t, maxPendingRead, len(p.pendingRead))
}

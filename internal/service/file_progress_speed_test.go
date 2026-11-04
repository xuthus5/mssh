package service

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestNextTransferSpeedUsesFixedWindow(t *testing.T) {
	start := time.Unix(100, 0)
	speed, initialized := nextTransferSpeed(transferSpeedSample{}, start, 512)
	assert.Zero(t, speed)
	assert.Equal(t, transferSpeedSample{at: start, bytes: 512}, initialized)

	sample := transferSpeedSample{at: start}

	speed, updated := nextTransferSpeed(sample, start.Add(500*time.Millisecond), 512)
	assert.Zero(t, speed)
	assert.Equal(t, sample, updated)

	speed, updated = nextTransferSpeed(sample, start.Add(time.Second), 2*1024*1024)
	assert.Equal(t, int64(2*1024*1024), speed)
	assert.Equal(t, int64(2*1024*1024), updated.bytes)

	speed, updated = nextTransferSpeed(updated, start.Add(1500*time.Millisecond), 3*1024*1024)
	assert.Equal(t, int64(2*1024*1024), speed)
	assert.Equal(t, int64(2*1024*1024), updated.bytes)

	speed, updated = nextTransferSpeed(updated, start.Add(3*time.Second), 5*1024*1024)
	assert.Equal(t, int64(3*1024*1024/2), speed)
	assert.Equal(t, int64(5*1024*1024), updated.bytes)

	speed, _ = nextTransferSpeed(updated, start.Add(4*time.Second), 0)
	assert.Zero(t, speed)
}

package store

import (
	"errors"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestWithBusyRetryEventuallySucceeds(t *testing.T) {
	attempts := 0
	err := withBusyRetry(func() error {
		attempts++
		if attempts < 3 {
			return errors.New("database is locked")
		}
		return nil
	})
	require.NoError(t, err)
	assert.Equal(t, 3, attempts)
}

func TestWithBusyRetryGivesUp(t *testing.T) {
	err := withBusyRetry(func() error {
		return errors.New("database is locked")
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "locked")
}

func TestIsSQLiteBusy(t *testing.T) {
	assert.True(t, isSQLiteBusy(errors.New("database is locked")))
	assert.False(t, isSQLiteBusy(errors.New("no such table")))
	assert.False(t, isSQLiteBusy(nil))
}

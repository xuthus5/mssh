package testutil

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestNewTestDBAndLogger(t *testing.T) {
	db := NewTestDB(t)
	var value int
	require.NoError(t, db.QueryRow("SELECT 1").Scan(&value))
	assert.Equal(t, 1, value)
	assert.NotNil(t, NewTestLogger())
}

func TestDatabaseBlockingHelpers(t *testing.T) {
	database := NewTestDB(t)
	rollback := HoldDatabaseConnection(t, database)
	baselineWaits := database.Stats().WaitCount
	queryDone := make(chan error, 1)
	go func() {
		var value int
		queryDone <- database.QueryRow("SELECT 1").Scan(&value)
	}()
	WaitForDatabaseWaitCount(t, database, baselineWaits+1)
	rollback()
	require.NoError(t, <-queryDone)
}

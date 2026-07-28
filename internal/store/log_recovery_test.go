package store

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestEndIncompleteSessionLogs(t *testing.T) {
	database := setupTestDB(t)
	first, err := CreateSessionLog(database, model.SessionLog{DataPath: "/tmp/first.log"})
	require.NoError(t, err)
	second, err := CreateSessionLog(database, model.SessionLog{DataPath: "/tmp/second.log"})
	require.NoError(t, err)
	require.NoError(t, EndSessionLog(database, second.ID))

	count, err := EndIncompleteSessionLogs(database)

	require.NoError(t, err)
	assert.EqualValues(t, 1, count)
	firstStored, err := GetSessionLog(database, first.ID)
	require.NoError(t, err)
	assert.NotNil(t, firstStored.EndedAt)
	secondStored, err := GetSessionLog(database, second.ID)
	require.NoError(t, err)
	assert.NotNil(t, secondStored.EndedAt)
}

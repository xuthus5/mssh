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

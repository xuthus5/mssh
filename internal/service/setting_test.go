package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSettingServiceGetSet(t *testing.T) {
	db := testutil.NewTestDB(t)

	svc := NewSettingService(db, testutil.NewTestLogger())

	val, err := svc.GetSetting("test_key")
	require.NoError(t, err)
	assert.Empty(t, val)

	err = svc.SetSetting("test_key", "test_value")
	require.NoError(t, err)

	val, err = svc.GetSetting("test_key")
	require.NoError(t, err)
	assert.Equal(t, "test_value", val)
}

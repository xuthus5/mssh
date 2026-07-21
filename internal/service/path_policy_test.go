package service

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestValidateLocalTransferPath(t *testing.T) {
	_, err := validateLocalTransferPath("  ")
	require.Error(t, err)
	_, err = validateLocalTransferPath("a" + string(rune(0)) + "b")
	require.Error(t, err)
	cleaned, err := validateLocalTransferPath("/tmp/../tmp/file.txt")
	require.NoError(t, err)
	assert.Equal(t, "/tmp/file.txt", cleaned)
}

func TestValidateRemotePath(t *testing.T) {
	require.Error(t, validateRemotePath(""))
	require.Error(t, validateRemotePath("a"+string(rune(0))+"b"))
	require.NoError(t, validateRemotePath("/var/log/app.log"))
}

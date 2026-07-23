package service

import (
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestFileServiceRemoteOpsRejectInvalidPaths(t *testing.T) {
	svc := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())

	_, err := svc.ListDir(1, "")
	require.Error(t, err)
	require.Contains(t, err.Error(), "remote path")

	require.Error(t, svc.Delete(1, "  "))
	require.Error(t, svc.Mkdir(1, "a"+string(rune(0))+"b"))
	require.Error(t, svc.Rename(1, "", "/tmp/x"))
	require.Error(t, svc.Rename(1, "/tmp/x", ""))
}

func TestFileServiceRejectsInvalidSessionID(t *testing.T) {
	svc := NewFileService(nil, newMockEventBus(), testutil.NewTestLogger())

	_, err := svc.ListDir(0, "/tmp")
	require.Error(t, err)
	require.Contains(t, err.Error(), "invalid session id")

	require.Error(t, svc.Delete(-1, "/tmp/x"))
	require.Error(t, svc.Mkdir(0, "/tmp/x"))
	require.Error(t, svc.Rename(0, "/tmp/a", "/tmp/b"))
}

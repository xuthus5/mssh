package ssh

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/stretchr/testify/require"
)

func TestEnsureKnownHostsFileCreatesParents(t *testing.T) {
	path := filepath.Join(t.TempDir(), "nested", "known_hosts")
	require.NoError(t, ensureKnownHostsFile(path))
	info, err := os.Stat(path)
	require.NoError(t, err)
	require.False(t, info.IsDir())
	// second call is no-op success
	require.NoError(t, ensureKnownHostsFile(path))
}

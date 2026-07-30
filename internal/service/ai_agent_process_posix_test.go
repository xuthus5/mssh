//go:build aix || darwin || dragonfly || freebsd || linux || netbsd || openbsd || solaris

package service

import (
	"context"
	"os/exec"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestAIAgentPOSIXProcessLifecycleCreatesProcessGroup(t *testing.T) {
	command, lifecycle, err := commandWithContext(context.Background(), exec.Command("sh", "-c", "exit 0"))
	require.NoError(t, err)
	t.Cleanup(func() { require.NoError(t, lifecycle.Close()) })
	require.NotNil(t, command.SysProcAttr)
	assert.True(t, command.SysProcAttr.Setpgid)
}

//go:build !windows

package localshell

import (
	"errors"
	"syscall"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

func TestForceKillLocalProcessGroup(t *testing.T) {
	groupFailure := errors.New("group kill failed")
	processFailure := errors.New("process kill failed")
	tests := []struct {
		name           string
		groupErr       error
		processErr     error
		wantProcess    bool
		wantGroupErr   bool
		wantProcessErr bool
	}{
		{name: "group kill succeeds"},
		{name: "missing group is already stopped", groupErr: syscall.ESRCH},
		{name: "fallback process kill succeeds", groupErr: groupFailure, wantProcess: true, wantGroupErr: true},
		{name: "both kill paths fail", groupErr: groupFailure, processErr: processFailure, wantProcess: true, wantGroupErr: true, wantProcessErr: true},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			processCalled := false
			err := forceKillLocalProcessGroup(42, func(processID int, signal syscall.Signal) error {
				assert.Equal(t, -42, processID)
				assert.Equal(t, syscall.SIGKILL, signal)
				return test.groupErr
			}, func() error {
				processCalled = true
				return test.processErr
			})

			assert.Equal(t, test.wantProcess, processCalled)
			if !test.wantGroupErr && !test.wantProcessErr {
				require.NoError(t, err)
				return
			}
			if test.wantGroupErr {
				assert.ErrorIs(t, err, groupFailure)
			}
			if test.wantProcessErr {
				assert.ErrorIs(t, err, processFailure)
			}
		})
	}
}

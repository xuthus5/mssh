package service

import (
	"os"
	"runtime"
)

func privateFileModeNeedsRepair(mode os.FileMode) bool {
	return runtime.GOOS != "windows" && mode.Perm() != 0o600
}

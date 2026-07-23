package service

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
)

func TestValidateLocalShellSettings(t *testing.T) {
	require.NoError(t, validateLocalShellSettings(nil))
	require.NoError(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellKey, Value: mustJSONString("/bin/bash")},
		{Key: terminalLocalShellArgsKey, Value: mustJSONString("-l")},
		{Key: terminalLocalShellCWDKey, Value: mustJSONString("~")},
	}))

	require.Error(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellKey, Value: mustJSONString(string([]byte{'a', 0}))},
	}))
	require.Error(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellKey, Value: mustJSONString(strings.Repeat("a", maxLocalShellPathRunes+1))},
	}))
	require.Error(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellKey, Value: mustJSONString("/tmp/../bin/bash")},
	}))
	require.Error(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellArgsKey, Value: mustJSONString(strings.Repeat("x", maxLocalShellArgsBytes+1))},
	}))
	require.Error(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellCWDKey, Value: mustJSONString(string([]byte{'/', 0}))},
	}))
	require.Error(t, validateLocalShellSettings([]model.Setting{
		{Key: terminalLocalShellCWDKey, Value: mustJSONString(strings.Repeat("d", maxLocalShellCWDRunes+1))},
	}))
}

func mustJSONString(value string) string {
	raw, err := json.Marshal(value)
	if err != nil {
		panic(err)
	}
	return string(raw)
}

package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestWriteInputsExcludeServerManagedTimestamps(t *testing.T) {
	now := time.Now()
	setting := SettingInputFrom(Setting{Key: "appearance.mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1, UpdatedAt: now}).Setting()
	session := SessionInputFrom(Session{ID: 1, Name: "server", CreatedAt: now, UpdatedAt: now}).Session()
	tunnel := TunnelInputFrom(Tunnel{ID: 2, Name: "forward", CreatedAt: now}).Tunnel()
	macro := MacroInputFrom(Macro{ID: 3, Name: "list", CreatedAt: now}).Macro()
	theme := ThemeInputFrom(Theme{ID: 4, Name: "dark", CreatedAt: now}).Theme()

	assert.True(t, setting.UpdatedAt.IsZero())
	assert.True(t, session.CreatedAt.IsZero())
	assert.True(t, session.UpdatedAt.IsZero())
	assert.True(t, tunnel.CreatedAt.IsZero())
	assert.True(t, macro.CreatedAt.IsZero())
	assert.True(t, theme.CreatedAt.IsZero())
}

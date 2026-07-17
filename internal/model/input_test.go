package model

import (
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
)

func TestWriteInputsExcludeServerManagedTimestamps(t *testing.T) {
	now := time.Now()
	setting := SettingInputFrom(Setting{Key: "appearance.mode", Namespace: "appearance", Value: `"dark"`, ValueType: "string", Version: 1, UpdatedAt: now}).Setting()
	environmentID, projectID := int64(4), int64(5)
	session := SessionInputFrom(Session{ID: 1, Name: "server", Notes: "critical", EnvironmentID: &environmentID, ProjectID: &projectID, Tags: []AssetTag{{ID: 6}, {ID: 7}}, CreatedAt: now, UpdatedAt: now}).Session()
	tunnel := TunnelInputFrom(Tunnel{ID: 2, Name: "forward", CreatedAt: now}).Tunnel()
	macro := MacroInputFrom(Macro{ID: 3, Name: "list", CreatedAt: now}).Macro()
	theme := ThemeDefinitionInputFrom(ThemeDefinition{ID: 4, Name: "dark", CreatedAt: now, UpdatedAt: now}).ThemeDefinition()

	assert.True(t, setting.UpdatedAt.IsZero())
	assert.True(t, session.CreatedAt.IsZero())
	assert.True(t, session.UpdatedAt.IsZero())
	assert.Equal(t, "critical", session.Notes)
	assert.Equal(t, environmentID, *session.EnvironmentID)
	assert.Equal(t, projectID, *session.ProjectID)
	assert.Equal(t, []int64{6, 7}, SessionInputFrom(Session{Tags: []AssetTag{{ID: 6}, {ID: 7}}}).TagIDs)
	assert.True(t, tunnel.CreatedAt.IsZero())
	assert.True(t, macro.CreatedAt.IsZero())
	assert.True(t, theme.CreatedAt.IsZero())
	assert.True(t, theme.UpdatedAt.IsZero())
}

func TestTerminalGlobalStyleInputConversions(t *testing.T) {
	input := TerminalGlobalStyleInput{FontFamily: "JetBrains Mono", FontSize: 16, CursorStyle: CursorStyleBlock, SelectionBackground: "#123456"}
	assert.Equal(t, TerminalGlobalStyle(input), input.TerminalGlobalStyle())
	assert.Equal(t, input, TerminalGlobalStyleInputFrom(input.TerminalGlobalStyle()))

	profile := ThemeProfile{ID: 7, FollowGlobalStyle: true, FontFamily: "mono", FontSize: 14, CursorStyle: CursorStyleBar}
	assert.True(t, ThemeProfileInputFrom(profile).FollowGlobalStyle)
}

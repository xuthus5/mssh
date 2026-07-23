package service

import (
	"strings"
	"testing"

	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestSessionAssetValidation(t *testing.T) {
	db := testutil.NewTestDB(t)
	service := NewSessionService(db, newMockEventBus(), 30, t.TempDir(), nil, testutil.NewTestLogger())
	base := model.SessionInput{Name: "server", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent, KeepAlive: 30, TermType: "xterm-256color"}

	tests := []struct {
		name   string
		mutate func(*model.SessionInput)
	}{
		{name: "notes too long", mutate: func(input *model.SessionInput) { input.Notes = strings.Repeat("x", sessionNotesLimit+1) }},
		{name: "invalid environment", mutate: func(input *model.SessionInput) { id := int64(0); input.EnvironmentID = &id }},
		{name: "invalid project", mutate: func(input *model.SessionInput) { id := int64(-1); input.ProjectID = &id }},
		{name: "invalid tag", mutate: func(input *model.SessionInput) { input.TagIDs = []int64{0} }},
		{name: "duplicate tag", mutate: func(input *model.SessionInput) { input.TagIDs = []int64{1, 1} }},
		{name: "empty name", mutate: func(input *model.SessionInput) { input.Name = "  " }},
		{name: "empty host", mutate: func(input *model.SessionInput) { input.Host = "" }},
		{name: "host too long", mutate: func(input *model.SessionInput) { input.Host = strings.Repeat("h", sessionHostLimit+1) }},
		{name: "host with nul", mutate: func(input *model.SessionInput) { input.Host = string([]byte{'b', 'a', 'd', 0, 'h', 'o', 's', 't'}) }},
		{name: "invalid port low", mutate: func(input *model.SessionInput) { input.Port = 0 }},
		{name: "invalid port high", mutate: func(input *model.SessionInput) { input.Port = 70000 }},
		{name: "empty username", mutate: func(input *model.SessionInput) { input.Username = "" }},
		{name: "username with nul", mutate: func(input *model.SessionInput) { input.Username = string([]byte{'u', 0}) }},
		{name: "bad auth method", mutate: func(input *model.SessionInput) { input.AuthMethod = "magic" }},
		{name: "key auth without key", mutate: func(input *model.SessionInput) { input.AuthMethod = model.AuthKey; input.KeyID = nil }},
		{name: "keep alive too large", mutate: func(input *model.SessionInput) { input.KeepAlive = sessionKeepAliveMax + 1 }},
		{name: "term type too long", mutate: func(input *model.SessionInput) { input.TermType = strings.Repeat("t", sessionTermTypeLimit+1) }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			input := base
			test.mutate(&input)
			_, err := service.CreateSession(input)
			require.Error(t, err)
		})
	}

	base.Notes = strings.Repeat("界", sessionNotesLimit)
	_, err := service.CreateSession(base)
	require.NoError(t, err)
	require.Error(t, service.UpdateSession(model.SessionInput{ID: 0}))
}

func TestValidateSessionCoreFieldsDirect(t *testing.T) {
	require.NoError(t, validateSessionCoreFields(model.SessionInput{
		Name: "ok", Host: "example.com", Port: 22, Username: "root", AuthMethod: model.AuthPassword, KeepAlive: 0,
	}))
	keyID := int64(3)
	require.NoError(t, validateSessionCoreFields(model.SessionInput{
		Name: "ok", Host: "example.com", Port: 22, Username: "root", AuthMethod: model.AuthKey, KeyID: &keyID, KeepAlive: 60, TermType: "xterm",
	}))
}

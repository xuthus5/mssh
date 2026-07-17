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
	service := NewSessionService(db, newMockEventBus(), 30, "", nil, testutil.NewTestLogger())
	base := model.SessionInput{Name: "server", Host: "127.0.0.1", Port: 22, Username: "root", AuthMethod: model.AuthAgent}

	tests := []struct {
		name   string
		mutate func(*model.SessionInput)
	}{
		{name: "notes too long", mutate: func(input *model.SessionInput) { input.Notes = strings.Repeat("x", sessionNotesLimit+1) }},
		{name: "invalid environment", mutate: func(input *model.SessionInput) { id := int64(0); input.EnvironmentID = &id }},
		{name: "invalid project", mutate: func(input *model.SessionInput) { id := int64(-1); input.ProjectID = &id }},
		{name: "invalid tag", mutate: func(input *model.SessionInput) { input.TagIDs = []int64{0} }},
		{name: "duplicate tag", mutate: func(input *model.SessionInput) { input.TagIDs = []int64{1, 1} }},
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

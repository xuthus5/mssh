package service

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func gistSyncTestInput(gistID, token string) model.SyncConfigInput {
	input := syncTestConfigInput()
	input.Provider = model.SyncProviderGist
	input.Gist = model.GistSyncConfigInput{GistID: gistID, Token: token}
	return input
}

type gistHTTPProviderFactory struct {
	server *httptest.Server
}

func (f gistHTTPProviderFactory) Create(_ context.Context, config model.SyncConfig, secrets syncProviderSecrets) (syncProvider, error) {
	return newGistSyncProvider(f.server.Client(), f.server.URL, config.Gist.GistID, secrets.GistToken)
}

func TestPushNowRecreatesMissingConfiguredGist(t *testing.T) {
	var created bool
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		switch {
		case request.Method == http.MethodGet && request.URL.Path == "/gists/missing":
			writer.WriteHeader(http.StatusNotFound)
		case request.Method == http.MethodPost && request.URL.Path == "/gists":
			created = true
			writer.Header().Set("ETag", `"new"`)
			writer.WriteHeader(http.StatusCreated)
			_ = json.NewEncoder(writer).Encode(gistResponse{ID: "recreated-gist"})
		default:
			writer.WriteHeader(http.StatusBadRequest)
		}
	}))
	t.Cleanup(server.Close)

	db := testutil.NewTestDB(t)
	setSyncMasterKey(t, db, syncTestMasterKey)
	service := newTestSyncService(db, syncTestMasterKey,
		WithSyncDataDir(t.TempDir()),
		WithSyncCrypto(syncTestCrypto{key: []byte("01234567890123456789012345678901")}),
		WithSyncProviderFactory(gistHTTPProviderFactory{server: server}),
	)
	_, err := service.SaveConfig(gistSyncTestInput("missing", "token"))
	require.NoError(t, err)
	_, err = store.CreateSession(db, model.Session{
		Name: "local", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)

	result, err := service.PushNow()
	require.NoError(t, err)
	assert.Equal(t, model.SyncStateSynced, result.State)
	assert.True(t, created)
	config, err := service.LoadConfig()
	require.NoError(t, err)
	assert.Equal(t, "recreated-gist", config.Gist.GistID)
}

func TestTestProviderAcceptsMissingConfiguredGist(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/user" {
			writer.WriteHeader(http.StatusOK)
			return
		}
		writer.WriteHeader(http.StatusNotFound)
	}))
	t.Cleanup(server.Close)

	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey,
		WithSyncProviderFactory(gistHTTPProviderFactory{server: server}),
	)
	require.NoError(t, service.TestProvider(gistSyncTestInput("missing", "token")))
	events, err := service.ListEvents()
	require.NoError(t, err)
	require.Len(t, events, 1)
	assert.Equal(t, model.SyncEventSuccess, events[0].Status)
}

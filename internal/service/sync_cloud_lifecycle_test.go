package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/model"
	"github.com/xuthus5/mssh/internal/service/testutil"
	"github.com/xuthus5/mssh/internal/store"
)

func TestSyncService_SyncFromCloudQuiescesActiveResources(t *testing.T) {
	var content []byte
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.Method == http.MethodPut {
			var err error
			content, err = io.ReadAll(request.Body)
			require.NoError(t, err)
			writer.WriteHeader(http.StatusNoContent)
			return
		}
		_, err := writer.Write(content)
		require.NoError(t, err)
	}))
	defer server.Close()

	sourceDB := testutil.NewTestDB(t)
	setSyncMasterKey(t, sourceDB, syncTestMasterKey)
	_, err := store.CreateSession(sourceDB, model.Session{
		Name: "remote", Host: "127.0.0.1", Port: 22, Username: "root",
		AuthMethod: model.AuthPassword, KeepAlive: 30, TermType: "xterm",
	})
	require.NoError(t, err)
	source := newTestSyncService(sourceDB, syncTestMasterKey)
	require.NoError(t, source.SyncToCloud(server.URL, "", ""))

	targetDB := testutil.NewTestDB(t)
	setSyncMasterKey(t, targetDB, syncTestMasterKey)
	lifecycle := &fakeSyncLifecycle{}
	target := newTestSyncService(targetDB, syncTestMasterKey, WithSyncLifecycle(lifecycle))
	require.NoError(t, target.SyncFromCloud(server.URL, "", ""))
	assert.Equal(t, 1, lifecycle.calls)
}

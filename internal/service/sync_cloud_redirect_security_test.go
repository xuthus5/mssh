package service

import (
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/xuthus5/mssh/internal/service/testutil"
)

func TestLegacyCloudUploadRejectsCrossOriginTemporaryRedirect(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		attackerCalls.Add(1)
		_, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Errorf("read redirected legacy cloud body: %v", readErr)
		}
		writer.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(attacker.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, attacker.URL+"/stolen", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(origin.Close)

	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	err := service.SyncToCloud(origin.URL, "alice", "secret")

	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, attackerCalls.Load())
}

func TestLegacyCloudUploadDoesNotFollowMovedRedirect(t *testing.T) {
	var redirectedCalls atomic.Int32
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/" {
			http.Redirect(writer, request, serverURL+"/target", http.StatusMovedPermanently)
			return
		}
		redirectedCalls.Add(1)
		writer.WriteHeader(http.StatusNoContent)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	err := service.SyncToCloud(server.URL, "", "")

	require.Error(t, err)
	assert.Zero(t, redirectedCalls.Load())
}

func TestLegacyCloudConnectionRejectsCrossOriginRedirect(t *testing.T) {
	var attackerCalls atomic.Int32
	attacker := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		attackerCalls.Add(1)
		writer.WriteHeader(http.StatusNoContent)
	}))
	t.Cleanup(attacker.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, attacker.URL+"/probe", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(origin.Close)

	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	err := service.TestCloudConnection(origin.URL, "alice", "secret")

	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, attackerCalls.Load())
}

func TestLegacyCloudUploadAllowsSameOriginTemporaryRedirect(t *testing.T) {
	var uploadedBytes atomic.Int64
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/" {
			http.Redirect(writer, request, serverURL+"/target", http.StatusTemporaryRedirect)
			return
		}
		content, readErr := io.ReadAll(request.Body)
		if readErr != nil {
			t.Errorf("read same-origin legacy cloud body: %v", readErr)
			return
		}
		uploadedBytes.Store(int64(len(content)))
		writer.Header().Set("ETag", `"v1"`)
		writer.WriteHeader(http.StatusNoContent)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)

	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	require.NoError(t, service.SyncToCloud(server.URL, "alice", "secret"))
	assert.Positive(t, uploadedBytes.Load())
}

func TestLegacyCloudUploadRejectsDeferredStatus(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		writer.WriteHeader(http.StatusAccepted)
	}))
	t.Cleanup(server.Close)

	service := newTestSyncService(testutil.NewTestDB(t), syncTestMasterKey)
	err := service.SyncToCloud(server.URL, "", "")
	require.ErrorContains(t, err, "202")
}

func TestCompletedSyncUploadStatuses(t *testing.T) {
	tests := map[int]bool{
		http.StatusOK: true, http.StatusCreated: true, http.StatusNoContent: true,
		http.StatusAccepted: false, http.StatusMultiStatus: false, 299: false,
	}
	for status, expected := range tests {
		assert.Equal(t, expected, isCompletedSyncUploadStatus(status), "status %d", status)
	}
}

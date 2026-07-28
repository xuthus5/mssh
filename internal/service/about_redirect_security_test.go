package service

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

const updateReleaseJSON = `{"tag_name":"v9.9.9","html_url":"https://github.com/xuthus5/mssh/releases/tag/v9.9.9"}`

func TestAboutServiceRejectsCrossOriginRedirect(t *testing.T) {
	var targetCalls atomic.Int32
	target := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, _ *http.Request) {
		targetCalls.Add(1)
		writeUpdateRelease(t, writer)
	}))
	t.Cleanup(target.Close)
	origin := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		http.Redirect(writer, request, target.URL+"/latest", http.StatusTemporaryRedirect)
	}))
	t.Cleanup(origin.Close)
	service := NewAboutService()
	service.latestAPIURL = origin.URL

	_, err := service.CheckUpdate(t.Context())

	require.ErrorContains(t, err, "different origin")
	assert.Zero(t, targetCalls.Load())
}

func TestAboutServiceDoesNotFollowMovedRedirect(t *testing.T) {
	var targetCalls atomic.Int32
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/source" {
			http.Redirect(writer, request, serverURL+"/latest", http.StatusMovedPermanently)
			return
		}
		targetCalls.Add(1)
		writeUpdateRelease(t, writer)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)
	service := NewAboutService()
	service.latestAPIURL = server.URL + "/source"

	_, err := service.CheckUpdate(t.Context())

	require.ErrorContains(t, err, "301")
	assert.Zero(t, targetCalls.Load())
}

func TestAboutServiceAllowsSameOriginTemporaryRedirect(t *testing.T) {
	var serverURL string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == "/source" {
			http.Redirect(writer, request, serverURL+"/latest", http.StatusTemporaryRedirect)
			return
		}
		writeUpdateRelease(t, writer)
	}))
	serverURL = server.URL
	t.Cleanup(server.Close)
	service := NewAboutService()
	service.latestAPIURL = server.URL + "/source"

	info, err := service.CheckUpdate(t.Context())

	require.NoError(t, err)
	assert.Equal(t, "v9.9.9", info.LatestVersion)
}

func writeUpdateRelease(t *testing.T, writer http.ResponseWriter) {
	t.Helper()
	writer.Header().Set("Content-Type", "application/json")
	if _, err := writer.Write([]byte(updateReleaseJSON)); err != nil {
		t.Errorf("write update release: %v", err)
	}
}
